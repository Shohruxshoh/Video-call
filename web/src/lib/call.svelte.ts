import { api } from './api';
import { socket, type ServerMsg } from './socket.svelte';
import { ringback, ringtone, unlockSounds, type Stopper } from './sounds';
import { randomId, storage } from './util';

export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';
export type CallKind = 'audio' | 'video';

interface Preset {
  width: number;
  height: number;
  fps: number;
  videoBps: number;
  audioBps: number;
}

// "Normal" still targets slow links: VGA at most; the browser's congestion control goes lower on its own.
const PRESETS: Record<'saver' | 'normal', Preset> = {
  saver: { width: 320, height: 240, fps: 12, videoBps: 150_000, audioBps: 16_000 },
  normal: { width: 640, height: 480, fps: 24, videoBps: 600_000, audioBps: 32_000 },
};

/** Below this estimated uplink, outgoing video is paused so audio keeps flowing. */
const LOW_BPS = 120_000;
const RECOVER_BPS = 300_000;
const CONNECT_TIMEOUT_MS = 30_000;
const LOST_TIMEOUT_MS = 40_000;
const STATS_MS = 2_000;
const FALLBACK_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

const AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

/** Ask the other side to send Opus with DTX (no packets during silence). */
function tuneSdp(sdp: string) {
  const pt = sdp.match(/a=rtpmap:(\d+) opus\/48000/i)?.[1];
  if (!pt) return sdp;
  return sdp.replace(new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`), (line, params: string) =>
    params.includes('usedtx') ? line : `a=fmtp:${pt} ${params};usedtx=1`,
  );
}

async function setEncoding(sender: RTCRtpSender | undefined, values: Partial<RTCRtpEncodingParameters>) {
  if (!sender?.track) return;
  const params = sender.getParameters();
  // Encodings only exist once negotiated; we tune again after connecting.
  if (!params.encodings?.length) return;
  Object.assign(params.encodings[0], values);
  await sender.setParameters(params).catch(() => {});
}

function mediaError(kind: 'audio' | 'video', err: unknown) {
  const name = (err as DOMException)?.name;
  const device = kind === 'audio' ? 'Mikrofon' : 'Kamera';
  if (!navigator.mediaDevices) return `${device} faqat xavfsiz (https) ulanishda ishlaydi.`;
  if (name === 'NotAllowedError') return `${device}ga ruxsat berilmagan. Brauzer sozlamalarida ruxsat bering.`;
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return `${device} topilmadi.`;
  if (name === 'NotReadableError') return `${device} boshqa ilovada band.`;
  return `${device}ni yoqib bo'lmadi.`;
}

class CallManager {
  phase = $state<CallPhase>('idle');
  kind = $state<CallKind>('audio');
  peerId = $state(0);
  micOn = $state(false);
  camOn = $state(false);
  remoteMic = $state(false);
  remoteCam = $state(false);
  remotePaused = $state(false);
  localStream = $state.raw<MediaStream | null>(null);
  remoteStream = $state.raw<MediaStream | null>(null);
  startedAt = $state(0);
  endedAfter = $state(0);
  endReason = $state('');
  quality = $state<'good' | 'fair' | 'poor' | null>(null);
  viaRelay = $state(false);
  reconnecting = $state(false);
  /** Outgoing video paused automatically because the uplink is too slow. */
  videoPaused = $state(false);
  dataSaver = $state(storage.get<boolean>('dataSaver') ?? false);
  facing = $state<'user' | 'environment'>('user');
  canSwitchCamera = $state(false);
  error = $state('');
  needsAudioTap = $state(false);
  audioEl: HTMLAudioElement | null = null;

  callId = '';
  isCaller = false;
  #pc: RTCPeerConnection | null = null;
  #audioTx: RTCRtpTransceiver | null = null;
  #videoTx: RTCRtpTransceiver | null = null;
  #mic: MediaStreamTrack | null = null;
  #cam: MediaStreamTrack | null = null;
  #pendingIce: RTCIceCandidateInit[] = [];
  #rtcQueue: Promise<void> = Promise.resolve();
  #ice: { servers: RTCIceServer[]; expires: number } | null = null;
  #sound: Stopper | null = null;
  #busy = { audio: false, video: false };
  #wakeLock: { release(): Promise<void> } | null = null;
  #statsTimer = 0;
  #connectTimer = 0;
  #disconnectTimer = 0;
  #lostTimer = 0;
  #endTimer = 0;
  #lastRestart = 0;
  #lowSamples = 0;
  #pausedAt = 0;
  #pauseBackoff = 20_000;

  constructor() {
    socket.on((m) => this.#onSignal(m));
    window.addEventListener('pagehide', () => {
      if (this.#inCall()) socket.send({ t: 'call:hangup', callId: this.callId });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.phase === 'active') void this.#keepAwake();
    });
  }

  get inProgress() {
    return this.#inCall();
  }

  // ---- user actions ----

  start(peerId: number, kind: CallKind) {
    if (this.#inCall()) return;
    this.#reset();
    this.unlockAudio();
    this.callId = randomId();
    this.peerId = peerId;
    this.kind = kind;
    this.isCaller = true;
    this.phase = 'outgoing';
    if (!socket.send({ t: 'call:invite', to: peerId, callId: this.callId, kind })) return this.#finish('no_connection');
    this.#sound = ringback();
    void this.#iceServers();
  }

  async accept() {
    if (this.phase !== 'incoming') return;
    this.unlockAudio();
    this.#stopSound();
    this.phase = 'connecting';
    await this.#createPc();
    if (this.phase !== 'connecting') return;
    if (!socket.send({ t: 'call:accept', callId: this.callId })) return this.#finish('no_connection');
    this.#armConnectTimeout();
  }

  reject() {
    if (this.phase !== 'incoming') return;
    socket.send({ t: 'call:reject', callId: this.callId });
    this.#finish('rejected_self');
  }

  hangup() {
    if (!this.#inCall()) return;
    socket.send({ t: 'call:hangup', callId: this.callId });
    this.#finish('hangup_self');
  }

  dismiss() {
    if (this.phase === 'ended') this.phase = 'idle';
  }

  /** Must run inside a click handler so iOS/Chrome allow the remote audio to play later. */
  unlockAudio() {
    unlockSounds();
    const el = this.audioEl;
    if (!el) return;
    if (!el.srcObject) el.srcObject = new MediaStream();
    el.play().catch(() => {});
  }

  tapToHear() {
    this.audioEl
      ?.play()
      .then(() => (this.needsAudioTap = false))
      .catch(() => {});
  }

  async toggleMic() {
    if (this.#busy.audio) return;
    this.#busy.audio = true;
    try {
      if (this.micOn) {
        this.#mic?.stop();
        this.#mic = null;
        this.micOn = false;
        await this.#audioTx?.sender.replaceTrack(null);
      } else {
        const track = await this.#getTrack('audio');
        if (!track) return;
        this.#mic = track;
        this.micOn = true;
        await this.#attachTracks();
      }
      this.#sendMediaState();
    } finally {
      this.#busy.audio = false;
    }
  }

  async toggleCam() {
    if (this.#busy.video) return;
    this.#busy.video = true;
    try {
      if (this.camOn) {
        this.#stopCam();
        await this.#videoTx?.sender.replaceTrack(null);
      } else {
        const track = await this.#getTrack('video');
        if (!track) return;
        this.#setCam(track);
        await this.#attachTracks();
        void this.#checkCameras();
      }
      this.#sendMediaState();
    } finally {
      this.#busy.video = false;
    }
  }

  async switchCamera() {
    if (this.#busy.video) return;
    this.#busy.video = true;
    try {
      this.facing = this.facing === 'user' ? 'environment' : 'user';
      if (!this.camOn) return;
      // Many phones can't open both cameras at once, so release the old one first.
      this.#cam?.stop();
      const track = await this.#getTrack('video');
      if (!track) {
        this.#stopCam();
        await this.#videoTx?.sender.replaceTrack(null);
        this.#sendMediaState();
        return;
      }
      this.#setCam(track);
      await this.#attachTracks();
    } finally {
      this.#busy.video = false;
    }
  }

  setDataSaver(on: boolean) {
    this.dataSaver = on;
    storage.set('dataSaver', on);
    const { facingMode: _facing, ...size } = this.#videoConstraints();
    void this.#cam?.applyConstraints(size).catch(() => {});
    void this.#tuneSenders();
  }

  // ---- signaling ----

  #onSignal(m: ServerMsg) {
    if (m.t === 'hello') {
      // The WebSocket reconnected: re-bind our call to the new connection.
      if (this.#inCall() && this.phase !== 'incoming') socket.send({ t: 'call:resume', callId: this.callId });
      return;
    }
    if (m.t === 'call:incoming') return this.#onIncoming(m);
    if (!this.callId || m.callId !== this.callId) return;

    switch (m.t) {
      case 'call:accepted':
        return void this.#onAccepted().catch((err) => {
          console.warn('call setup failed', err);
          this.hangup();
        });
      case 'call:taken':
        return this.#finish('taken', true);
      case 'call:end':
        return this.#finish(m.reason);
      case 'call:resumed':
      case 'call:peer-back':
        if (!this.#isConnected()) this.#restartIce(true);
        return;
      case 'rtc':
        this.#rtcQueue = this.#rtcQueue.then(() => this.#onRtc(m.data)).catch((err) => console.warn('rtc', err));
        return;
    }
  }

  #onIncoming(m: ServerMsg) {
    // Both called each other at once: the server kept their call and will refuse ours as busy.
    if (this.phase === 'outgoing' && this.peerId === m.from) this.#finish('glare', true);
    if (this.#inCall()) return;
    this.#reset();
    this.callId = m.callId;
    this.peerId = m.from;
    this.kind = m.kind === 'video' ? 'video' : 'audio';
    this.isCaller = false;
    this.phase = 'incoming';
    this.#sound = ringtone();
    navigator.vibrate?.([400, 200, 400, 200, 400]);
    void this.#iceServers();
  }

  async #onAccepted() {
    if (this.phase !== 'outgoing') return;
    this.#stopSound();
    this.phase = 'connecting';
    this.#armConnectTimeout();
    const pc = await this.#createPc();
    this.#audioTx = pc.addTransceiver('audio', { direction: 'sendrecv' });
    this.#videoTx = pc.addTransceiver('video', { direction: 'sendrecv' });
    await this.#attachTracks();
    await this.#sendOffer();
  }

  async #onRtc(data: any) {
    const pc = this.#pc;
    if (!pc || !data || typeof data !== 'object') return;

    if (data.sdp?.type === 'offer' && !this.isCaller) {
      await pc.setRemoteDescription(data.sdp);
      await this.#flushIce();
      if (!this.#audioTx) {
        for (const t of pc.getTransceivers()) {
          const kind = t.receiver.track.kind;
          if (kind === 'audio') this.#audioTx ??= t;
          if (kind === 'video') this.#videoTx ??= t;
          t.direction = 'sendrecv';
        }
        await this.#attachTracks();
      }
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.#rtc({ sdp: { type: answer.type, sdp: tuneSdp(answer.sdp ?? '') } });
    } else if (data.sdp?.type === 'answer' && this.isCaller) {
      if (pc.signalingState !== 'have-local-offer') return;
      await pc.setRemoteDescription(data.sdp);
      await this.#flushIce();
    } else if (data.candidate) {
      if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
      else this.#pendingIce.push(data.candidate);
    } else if (data.media) {
      this.remoteMic = !!data.media.mic;
      this.remoteCam = !!data.media.cam;
      this.remotePaused = !!data.media.paused;
    } else if (data.restart && this.isCaller) {
      this.#restartIce(true);
    }
  }

  #rtc(data: object) {
    socket.send({ t: 'rtc', callId: this.callId, data });
  }

  async #sendOffer(iceRestart = false) {
    const pc = this.#pc;
    if (!pc) return;
    const offer = await pc.createOffer({ iceRestart });
    await pc.setLocalDescription(offer);
    this.#rtc({ sdp: { type: offer.type, sdp: tuneSdp(offer.sdp ?? '') } });
  }

  async #flushIce() {
    const pc = this.#pc;
    const queued = this.#pendingIce;
    this.#pendingIce = [];
    for (const c of queued) await pc?.addIceCandidate(c).catch(() => {});
  }

  #sendMediaState() {
    if (this.phase === 'connecting' || this.phase === 'active') {
      this.#rtc({ media: { mic: this.micOn, cam: this.camOn, paused: this.videoPaused } });
    }
  }

  // ---- peer connection ----

  async #iceServers(): Promise<RTCIceServer[]> {
    if (this.#ice && this.#ice.expires > Date.now()) return this.#ice.servers;
    try {
      const r = await api<{ iceServers: RTCIceServer[]; ttl: number }>('GET', '/api/ice');
      this.#ice = { servers: r.iceServers, expires: Date.now() + (r.ttl - 600) * 1000 };
      return r.iceServers;
    } catch {
      return FALLBACK_ICE;
    }
  }

  async #createPc() {
    const pc = new RTCPeerConnection({
      iceServers: await this.#iceServers(),
      iceTransportPolicy: storage.get<boolean>('relayOnly') ? 'relay' : 'all',
      bundlePolicy: 'max-bundle',
    });
    this.#pc = pc;
    pc.ontrack = (e) => {
      const tracks = this.remoteStream?.getTracks() ?? [];
      // A fresh MediaStream object makes the <video>/<audio> elements pick the new track up reliably.
      this.remoteStream = new MediaStream([...tracks.filter((t) => t.kind !== e.track.kind), e.track]);
      this.#playRemoteAudio();
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) this.#rtc({ candidate: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => this.#onConnectionState();
    pc.oniceconnectionstatechange = () => this.#onConnectionState();
    return pc;
  }

  /** connectionState where supported, ICE state otherwise (older Safari). */
  #state(): RTCPeerConnectionState | RTCIceConnectionState {
    const pc = this.#pc;
    if (!pc) return 'closed';
    return pc.connectionState ?? pc.iceConnectionState;
  }

  #isConnected() {
    const s = this.#state();
    return s === 'connected' || s === 'completed';
  }

  #onConnectionState() {
    const state = this.#state();
    if (state === 'connected' || state === 'completed') {
      clearTimeout(this.#connectTimer);
      clearTimeout(this.#disconnectTimer);
      clearTimeout(this.#lostTimer);
      this.#lostTimer = 0;
      this.reconnecting = false;
      if (this.phase === 'connecting') {
        this.phase = 'active';
        this.startedAt = Date.now();
        this.#statsTimer = setInterval(() => void this.#sample(), STATS_MS);
        void this.#keepAwake();
      }
      void this.#tuneSenders();
      this.#sendMediaState();
    } else if (state === 'disconnected' || state === 'failed') {
      if (this.phase !== 'active') return;
      this.reconnecting = true;
      if (!this.#lostTimer) this.#lostTimer = setTimeout(() => this.#endLost(), LOST_TIMEOUT_MS);
      clearTimeout(this.#disconnectTimer);
      // "disconnected" often recovers by itself within a few seconds; "failed" never does.
      this.#disconnectTimer = setTimeout(() => this.#restartIce(), state === 'failed' ? 0 : 3000);
    }
  }

  #restartIce(force = false) {
    const pc = this.#pc;
    if (!pc || !this.#inCall() || (!force && this.#isConnected())) return;
    if (Date.now() - this.#lastRestart < 4000) return;
    this.#lastRestart = Date.now();
    if (this.isCaller) {
      if (pc.signalingState === 'stable') void this.#sendOffer(true).catch(() => {});
    } else {
      this.#rtc({ restart: true });
    }
  }

  #armConnectTimeout() {
    clearTimeout(this.#connectTimer);
    this.#connectTimer = setTimeout(() => {
      if (this.phase === 'connecting') {
        socket.send({ t: 'call:hangup', callId: this.callId });
        this.#finish('connect_failed');
      }
    }, CONNECT_TIMEOUT_MS);
  }

  #endLost() {
    socket.send({ t: 'call:hangup', callId: this.callId });
    this.#finish('lost');
  }

  // ---- media ----

  #videoConstraints(): MediaTrackConstraints {
    const p = PRESETS[this.dataSaver ? 'saver' : 'normal'];
    return {
      width: { ideal: p.width },
      height: { ideal: p.height },
      frameRate: { ideal: p.fps, max: p.fps },
      facingMode: { ideal: this.facing },
    };
  }

  async #getTrack(kind: 'audio' | 'video') {
    this.error = '';
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        kind === 'audio' ? { audio: AUDIO } : { video: this.#videoConstraints() },
      );
      const track = stream.getTracks()[0];
      // The call may have ended while the permission prompt was open.
      if (!this.#inCall()) {
        track.stop();
        return null;
      }
      track.onended = () => {
        if (kind === 'audio' && this.#mic === track) void this.toggleMic();
        if (kind === 'video' && this.#cam === track) void this.toggleCam();
      };
      return track;
    } catch (err) {
      this.error = mediaError(kind, err);
      return null;
    }
  }

  #setCam(track: MediaStreamTrack) {
    this.#cam = track;
    this.camOn = true;
    this.localStream = new MediaStream([track]);
  }

  #stopCam() {
    this.#cam?.stop();
    this.#cam = null;
    this.camOn = false;
    this.videoPaused = false;
    this.localStream = null;
  }

  async #attachTracks() {
    if (this.#audioTx && this.#audioTx.sender.track !== this.#mic) await this.#audioTx.sender.replaceTrack(this.#mic);
    if (this.#videoTx && this.#videoTx.sender.track !== this.#cam) await this.#videoTx.sender.replaceTrack(this.#cam);
    await this.#tuneSenders();
  }

  async #tuneSenders() {
    const p = PRESETS[this.dataSaver ? 'saver' : 'normal'];
    await setEncoding(this.#audioTx?.sender, { maxBitrate: p.audioBps });
    await setEncoding(this.#videoTx?.sender, { maxBitrate: p.videoBps, maxFramerate: p.fps, active: !this.videoPaused });
  }

  async #checkCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.canSwitchCamera = devices.filter((d) => d.kind === 'videoinput').length > 1;
    } catch {
      this.canSwitchCamera = false;
    }
  }

  #playRemoteAudio() {
    const el = this.audioEl;
    if (!el || !this.remoteStream) return;
    el.srcObject = this.remoteStream;
    el.play()
      .then(() => (this.needsAudioTap = false))
      .catch(() => (this.needsAudioTap = true));
  }

  async #keepAwake() {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } })
        .wakeLock;
      if (wl) this.#wakeLock = await wl.request('screen');
    } catch {
      /* not supported or denied */
    }
  }

  // ---- connection quality ----

  async #sample() {
    const pc = this.#pc;
    if (!pc) return;
    const report = await pc.getStats().catch(() => null);
    if (!report) return;

    let pairId = '';
    report.forEach((r) => {
      if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId;
    });
    let pair: any;
    let loss = 0;
    let remoteRtt: number | undefined;
    report.forEach((r) => {
      if (r.type === 'candidate-pair' && (pairId ? r.id === pairId : r.nominated && r.state === 'succeeded')) pair = r;
      if (r.type === 'remote-inbound-rtp' && r.kind === 'audio') {
        loss = r.fractionLost ?? 0;
        remoteRtt = r.roundTripTime;
      }
    });

    if (pair) {
      const local = report.get(pair.localCandidateId);
      const remote = report.get(pair.remoteCandidateId);
      this.viaRelay = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
    }
    const rtt: number | undefined = pair?.currentRoundTripTime ?? remoteRtt;
    this.quality =
      rtt === undefined ? null : rtt < 0.3 && loss < 0.03 ? 'good' : rtt < 0.8 && loss < 0.1 ? 'fair' : 'poor';

    if (this.reconnecting && Date.now() - this.#lastRestart > 6000) this.#restartIce();
    this.#adaptVideo(pair?.availableOutgoingBitrate);
  }

  /** Pause our outgoing video when the uplink can't carry it, and retry with backoff. */
  #adaptVideo(bps: number | undefined) {
    if (!this.camOn || bps === undefined) return;
    if (!this.videoPaused) {
      this.#lowSamples = bps < LOW_BPS ? this.#lowSamples + 1 : 0;
      if (this.#lowSamples < 3) return;
      this.#lowSamples = 0;
      this.videoPaused = true;
      this.#pausedAt = Date.now();
    } else {
      const recovered = bps > RECOVER_BPS;
      if (!recovered && Date.now() - this.#pausedAt < this.#pauseBackoff) return;
      this.#pauseBackoff = recovered ? 20_000 : Math.min(this.#pauseBackoff * 2, 160_000);
      this.videoPaused = false;
    }
    void this.#tuneSenders();
    this.#sendMediaState();
  }

  // ---- lifecycle ----

  #inCall() {
    return this.phase === 'outgoing' || this.phase === 'incoming' || this.phase === 'connecting' || this.phase === 'active';
  }

  #stopSound() {
    this.#sound?.();
    this.#sound = null;
    navigator.vibrate?.(0);
  }

  #finish(reason: string, quiet = false) {
    if (this.phase === 'idle' || this.phase === 'ended') return;
    this.endedAfter = this.startedAt ? Date.now() - this.startedAt : 0;
    this.#teardown();
    if (quiet) {
      this.phase = 'idle';
      return;
    }
    this.endReason = reason;
    this.phase = 'ended';
    this.#endTimer = setTimeout(() => this.dismiss(), 2500);
  }

  #teardown() {
    this.#stopSound();
    clearInterval(this.#statsTimer);
    for (const t of [this.#connectTimer, this.#disconnectTimer, this.#lostTimer]) clearTimeout(t);
    this.#lostTimer = 0;
    this.#mic?.stop();
    this.#cam?.stop();
    this.#mic = this.#cam = null;
    this.#pc?.close();
    this.#pc = null;
    this.#audioTx = this.#videoTx = null;
    this.#pendingIce = [];
    this.#rtcQueue = Promise.resolve();
    if (this.audioEl) this.audioEl.srcObject = null;
    void this.#wakeLock?.release().catch(() => {});
    this.#wakeLock = null;
    this.callId = '';
    this.micOn = this.camOn = false;
    this.remoteMic = this.remoteCam = this.remotePaused = false;
    this.localStream = this.remoteStream = null;
    this.reconnecting = this.videoPaused = this.needsAudioTap = false;
    this.quality = null;
    this.viaRelay = false;
    this.startedAt = 0;
  }

  #reset() {
    clearTimeout(this.#endTimer);
    this.#teardown();
    this.error = '';
    this.endReason = '';
    this.endedAfter = 0;
    this.#lowSamples = 0;
    this.#pauseBackoff = 20_000;
    this.#lastRestart = 0;
  }
}

export const call = new CallManager();
