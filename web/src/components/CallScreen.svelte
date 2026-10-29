<script lang="ts">
  import { app } from '../lib/state.svelte';
  import { call } from '../lib/call.svelte';
  import { CALL_END } from '../lib/text';
  import { duration } from '../lib/util';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';

  let remoteVideo = $state<HTMLVideoElement>();
  let localVideo = $state<HTMLVideoElement>();
  let now = $state(Date.now());

  const name = $derived(app.friends.find((f) => f.id === call.peerId)?.displayName ?? "Do'stingiz");
  const ended = $derived(call.phase === 'ended');
  const showRemoteVideo = $derived(call.phase === 'active' && call.remoteCam && !call.remotePaused);

  const status = $derived.by(() => {
    switch (call.phase) {
      case 'outgoing':
        return 'Chaqirilmoqda…';
      case 'connecting':
        return 'Ulanmoqda…';
      case 'active':
        return call.reconnecting ? 'Aloqa tiklanmoqda…' : duration(now - call.startedAt);
      case 'ended': {
        const text = CALL_END[call.endReason] ?? "Qo'ng'iroq tugadi";
        return call.endedAfter ? `${text} (${duration(call.endedAfter)})` : text;
      }
      default:
        return '';
    }
  });

  const peerState = $derived.by(() => {
    if (call.phase !== 'active') return '';
    if (!call.remoteMic && !call.remoteCam) return `${name}ning mikrofoni va kamerasi o'chiq`;
    if (!call.remoteMic) return `${name}ning mikrofoni o'chiq`;
    return '';
  });

  const qualityText = $derived(
    call.quality === 'good' ? 'yaxshi' : call.quality === 'fair' ? "o'rtacha" : call.quality === 'poor' ? 'past' : '',
  );
  const bars = $derived(call.quality === 'good' ? 3 : call.quality === 'fair' ? 2 : call.quality === 'poor' ? 1 : 0);

  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(t);
  });

  $effect(() => {
    if (remoteVideo) remoteVideo.srcObject = call.remoteStream;
  });

  $effect(() => {
    if (localVideo) localVideo.srcObject = call.localStream;
  });
</script>

<div class="call" class:video={showRemoteVideo}>
  <!-- Audio plays through the shared <audio> element; this one stays muted. -->
  <video class="remote" class:shown={showRemoteVideo} bind:this={remoteVideo} autoplay playsinline muted></video>

  <div class="head" class:compact={showRemoteVideo}>
    {#if !showRemoteVideo}
      <Avatar {name} id={call.peerId} size={120} />
    {/if}
    <h2>{name}</h2>
    <p class="status" aria-live="polite">{status}</p>
    {#if peerState && !showRemoteVideo}<p class="peer-state">{peerState}</p>{/if}
  </div>

  {#if call.phase === 'active'}
    <div class="quality" title="Aloqa sifati: {qualityText}{call.viaRelay ? ', server orqali' : ''}">
      {#each [1, 2, 3] as n (n)}
        <span class="bar" class:lit={n <= bars} style:height="{6 + n * 4}px"></span>
      {/each}
      <span class="visually-hidden">Aloqa sifati: {qualityText}</span>
    </div>
  {/if}

  {#if call.camOn}
    <video class="local" class:mirror={call.facing === 'user'} bind:this={localVideo} autoplay playsinline muted></video>
  {/if}

  <div class="notes">
    {#if call.needsAudioTap}
      <button class="note action" onclick={() => call.tapToHear()}>
        <Icon name="volume" size={20} />
        Ovozni eshitish uchun bosing
      </button>
    {/if}
    {#if call.error}<p class="note warn">{call.error}</p>{/if}
    {#if call.videoPaused}
      <p class="note warn">Internet sekin: videongiz vaqtincha to'xtatildi, ovoz davom etmoqda.</p>
    {/if}
    {#if call.phase === 'active' && call.remoteCam && call.remotePaused}
      <p class="note">{name}ning interneti sekin, uning videosi vaqtincha to'xtadi.</p>
    {/if}
    {#if call.phase === 'active' && !call.micOn}
      <p class="note">Mikrofoningiz o'chiq. Gapirish uchun uni yoqing.</p>
    {/if}
  </div>

  <div class="controls">
    {#if !ended}
      <button class="ctl" class:on={call.micOn} aria-pressed={call.micOn} onclick={() => call.toggleMic()}>
        <Icon name={call.micOn ? 'mic' : 'mic-off'} size={26} />
        <span>Mikrofon</span>
      </button>
      <button class="ctl" class:on={call.camOn} aria-pressed={call.camOn} onclick={() => call.toggleCam()}>
        <Icon name={call.camOn ? 'cam' : 'cam-off'} size={26} />
        <span>Kamera</span>
      </button>
      {#if call.camOn && call.canSwitchCamera}
        <button class="ctl" onclick={() => call.switchCamera()}>
          <Icon name="flip" size={26} />
          <span>Almashtirish</span>
        </button>
      {/if}
      <button
        class="ctl"
        class:on={call.dataSaver}
        aria-pressed={call.dataSaver}
        title="Past sifatli video, kam trafik"
        onclick={() => call.setDataSaver(!call.dataSaver)}
      >
        <Icon name="gauge" size={26} />
        <span>Tejamkor</span>
      </button>
      <button class="ctl end" onclick={() => call.hangup()}>
        <Icon name="hangup" size={28} />
        <span>Tugatish</span>
      </button>
    {:else}
      <button class="ctl" onclick={() => call.dismiss()}>
        <Icon name="x" size={26} />
        <span>Yopish</span>
      </button>
    {/if}
  </div>
</div>

<style>
  .call {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    grid-template-rows: 1fr auto auto;
    background: var(--night);
    color: #fff;
    overflow: hidden;
  }

  .remote {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
    opacity: 0;
    pointer-events: none;
  }

  .remote.shown {
    opacity: 1;
  }

  .head {
    position: relative;
    align-self: center;
    display: grid;
    justify-items: center;
    gap: 6px;
    padding: 24px 16px;
    text-align: center;
  }

  .head > :global(.avatar) {
    margin-bottom: 18px;
  }

  .head.compact {
    align-self: start;
    justify-items: start;
    gap: 0;
    padding: calc(16px + env(safe-area-inset-top)) 16px 32px;
    text-align: left;
    background: linear-gradient(rgb(0 0 0 / 0.5), transparent);
  }

  h2 {
    font-size: 26px;
    font-weight: 700;
  }

  .compact h2 {
    font-size: 18px;
  }

  .status {
    color: rgb(255 255 255 / 0.8);
    font-variant-numeric: tabular-nums;
  }

  .peer-state {
    margin-top: 6px;
    color: rgb(255 255 255 / 0.6);
    font-size: 14px;
  }

  .quality {
    position: absolute;
    top: calc(18px + env(safe-area-inset-top));
    right: 18px;
    display: flex;
    align-items: flex-end;
    gap: 3px;
  }

  .bar {
    width: 4px;
    border-radius: 2px;
    background: rgb(255 255 255 / 0.25);
  }

  .bar.lit {
    background: #fff;
  }

  .local {
    position: absolute;
    right: 16px;
    bottom: calc(132px + env(safe-area-inset-bottom));
    width: min(30vw, 180px);
    max-height: 32vh;
    border-radius: 14px;
    object-fit: cover;
    background: var(--night-2);
    box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
  }

  .local.mirror {
    transform: scaleX(-1);
  }

  .notes {
    position: relative;
    display: grid;
    justify-items: center;
    gap: 8px;
    padding: 0 16px 12px;
  }

  .note {
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: 44ch;
    padding: 8px 14px;
    border: 0;
    border-radius: 12px;
    background: rgb(255 255 255 / 0.12);
    color: #fff;
    font-size: 14px;
    text-align: center;
    backdrop-filter: blur(6px);
  }

  .note.warn {
    background: rgb(201 133 18 / 0.85);
  }

  .note.action {
    background: #fff;
    color: var(--night);
    font-weight: 600;
  }

  .controls {
    position: relative;
    display: flex;
    justify-content: center;
    gap: clamp(8px, 3vw, 20px);
    padding: 12px 8px calc(20px + env(safe-area-inset-bottom));
  }

  .ctl {
    display: grid;
    justify-items: center;
    gap: 6px;
    width: 64px;
    border: 0;
    background: transparent;
    color: #fff;
    font-size: 12px;
  }

  .ctl :global(svg) {
    box-sizing: content-box;
    padding: 14px;
    border-radius: 50%;
    background: rgb(255 255 255 / 0.14);
  }

  .ctl.on :global(svg) {
    background: #fff;
    color: var(--night);
  }

  .ctl.end :global(svg) {
    background: var(--anor);
    color: #fff;
  }

  .ctl span {
    color: rgb(255 255 255 / 0.8);
  }
</style>
