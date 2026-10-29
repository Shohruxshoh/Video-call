export type ServerMsg = { t: string } & Record<string, any>;
type Listener = (msg: ServerMsg) => void;

const PING_MS = 15_000;
/** No traffic for this long means the socket is dead even if the browser hasn't noticed. */
const STALE_MS = 40_000;
const PROBE_MS = 5_000;

/**
 * WebSocket that keeps itself alive on flaky mobile networks: app-level pings,
 * backoff reconnects, and an immediate re-check when the network or tab visibility changes.
 */
class Socket {
  status = $state<'idle' | 'connecting' | 'open' | 'closed'>('idle');
  failures = 0;
  #ws: WebSocket | null = null;
  #listeners = new Set<Listener>();
  #running = false;
  #retryTimer = 0;
  #pingTimer = 0;
  #lastSeen = 0;

  constructor() {
    window.addEventListener('online', () => this.#probe());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.#probe();
    });
    // Chrome/Android: fires when switching between Wi-Fi and mobile data.
    (navigator as Navigator & { connection?: EventTarget }).connection?.addEventListener('change', () => this.#probe());
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    this.failures = 0;
    this.#connect();
  }

  stop() {
    this.#running = false;
    clearTimeout(this.#retryTimer);
    clearInterval(this.#pingTimer);
    const ws = this.#ws;
    this.#ws = null;
    ws?.close();
    this.status = 'idle';
  }

  on(fn: Listener) {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  send(msg: object): boolean {
    if (this.#ws?.readyState !== WebSocket.OPEN) return false;
    this.#ws.send(JSON.stringify(msg));
    return true;
  }

  #emit(msg: ServerMsg) {
    for (const fn of this.#listeners) {
      try {
        fn(msg);
      } catch (err) {
        console.error(err);
      }
    }
  }

  #connect() {
    clearTimeout(this.#retryTimer);
    clearInterval(this.#pingTimer);
    const old = this.#ws;
    this.#ws = null;
    old?.close();

    this.status = 'connecting';
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.#ws = ws;

    ws.onopen = () => {
      if (this.#ws !== ws) return;
      this.failures = 0;
      this.#lastSeen = Date.now();
      this.status = 'open';
      this.#pingTimer = setInterval(() => {
        this.send({ t: 'ping' });
        if (Date.now() - this.#lastSeen > STALE_MS) this.#connect();
      }, PING_MS);
    };

    ws.onmessage = (e) => {
      if (this.#ws !== ws) return;
      this.#lastSeen = Date.now();
      let msg: ServerMsg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.t !== 'pong') this.#emit(msg);
    };

    ws.onclose = () => {
      if (this.#ws !== ws) return;
      this.#ws = null;
      clearInterval(this.#pingTimer);
      if (!this.#running) return;
      this.status = 'closed';
      this.failures++;
      this.#emit({ t: '_closed', failures: this.failures });
      const delay = Math.min(15_000, 500 * 2 ** Math.min(this.failures, 5)) * (0.75 + Math.random() * 0.5);
      this.#retryTimer = setTimeout(() => this.#connect(), delay);
    };
  }

  /** Something changed (network, visibility): verify the socket quickly instead of waiting for the next ping. */
  #probe() {
    if (!this.#running) return;
    if (this.status !== 'open') return this.#connect();
    const sentAt = Date.now();
    this.send({ t: 'ping' });
    setTimeout(() => {
      if (this.#running && this.status === 'open' && this.#lastSeen < sentAt) this.#connect();
    }, PROBE_MS);
  }
}

export const socket = new Socket();
