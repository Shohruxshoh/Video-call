import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { Db } from './db.ts';
import { int, str } from './context.ts';
import { toFriend } from './views.ts';

const RING_MS = 45_000;
/** How long a call survives one side losing its connection (network switch, tunnel, ...). */
const GRACE_MS = 30_000;
/** Delay before announcing "offline", so a quick reconnect doesn't flicker presence. */
const OFFLINE_DEBOUNCE_MS = 5_000;
const HEARTBEAT_MS = 25_000;
const MAX_BODY = 4000;
const RATE_WINDOW_MS = 10_000;
const RATE_MAX = 200;
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

interface Conn {
  id: string;
  userId: number;
  ws: WebSocket;
  alive: boolean;
  budget: number;
  budgetReset: number;
}

interface Side {
  userId: number;
  /** Connection taking part in the call; null for the callee while it is still ringing on all devices. */
  connId: string | null;
  grace: NodeJS.Timeout | null;
}

interface Call {
  id: string;
  kind: 'audio' | 'video';
  state: 'ringing' | 'active';
  caller: Side;
  callee: Side;
  ring: NodeJS.Timeout | null;
}

type Incoming = Record<string, unknown> & { t: string };

/**
 * Realtime state: who is connected, chat delivery and 1:1 call signaling.
 * Every action that reaches another user is checked against the friendship table.
 */
export class Hub {
  #db: Db;
  #users = new Map<number, Map<string, Conn>>();
  #calls = new Map<string, Call>();
  #callOf = new Map<number, string>();
  #offlineTimers = new Map<number, NodeJS.Timeout>();
  #heartbeat: NodeJS.Timeout;

  constructor(db: Db) {
    this.#db = db;
    this.#heartbeat = setInterval(() => this.#beat(), HEARTBEAT_MS).unref();
  }

  attach(ws: WebSocket, userId: number) {
    const conn: Conn = { id: randomUUID(), userId, ws, alive: true, budget: 0, budgetReset: 0 };
    let conns = this.#users.get(userId);
    const cameOnline = !conns;
    if (!conns) this.#users.set(userId, (conns = new Map()));
    conns.set(conn.id, conn);

    const pendingOffline = this.#offlineTimers.get(userId);
    if (pendingOffline) {
      // Friends were never told we went offline.
      clearTimeout(pendingOffline);
      this.#offlineTimers.delete(userId);
    } else if (cameOnline) {
      this.#toFriends(userId, { t: 'presence', userId, online: true });
    }

    ws.on('pong', () => {
      conn.alive = true;
    });
    ws.on('message', (data, isBinary) => {
      conn.alive = true;
      if (isBinary || !this.#allow(conn)) return;
      let msg: unknown;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object' || typeof (msg as Incoming).t !== 'string') return;
      try {
        this.#handle(conn, msg as Incoming);
      } catch (err) {
        console.error('ws handler failed', err);
      }
    });
    ws.on('close', () => this.#detach(conn));
    ws.on('error', () => ws.terminate());

    const online = this.#db.friendIds(userId).filter((id) => this.isOnline(id));
    this.#send(conn, { t: 'hello', connId: conn.id, online });

    // A device that (re)connects while a call to us is ringing should ring too.
    const call = this.#callFor(userId);
    if (call && call.state === 'ringing' && call.callee.userId === userId) {
      this.#send(conn, { t: 'call:incoming', callId: call.id, from: call.caller.userId, kind: call.kind });
    }
  }

  /** Online for presence purposes (includes the short reconnect window). */
  isOnline(userId: number) {
    return this.#users.has(userId) || this.#offlineTimers.has(userId);
  }

  friendView(me: number, friendId: number) {
    const row = this.#db.listFriends(me).find((f) => f.id === friendId);
    return row ? toFriend(row, this.isOnline(friendId)) : null;
  }

  friendshipCreated(a: number, b: number) {
    for (const [me, other] of [
      [a, b],
      [b, a],
    ]) {
      const friend = this.friendView(me, other);
      if (friend) this.#toUser(me, { t: 'friend:new', friend });
    }
  }

  friendshipRemoved(a: number, b: number) {
    this.#toUser(a, { t: 'friend:removed', userId: b });
    this.#toUser(b, { t: 'friend:removed', userId: a });
    const call = this.#callFor(a);
    if (call && this.#isParty(call, b)) this.#endCall(call, 'forbidden');
  }

  close() {
    clearInterval(this.#heartbeat);
    for (const timer of this.#offlineTimers.values()) clearTimeout(timer);
    for (const call of [...this.#calls.values()]) this.#endCall(call, 'shutdown');
    for (const conns of this.#users.values()) for (const conn of conns.values()) conn.ws.terminate();
  }

  // ---- connection bookkeeping ----

  #detach(conn: Conn) {
    const conns = this.#users.get(conn.userId);
    if (!conns?.delete(conn.id)) return;
    if (conns.size === 0) {
      this.#users.delete(conn.userId);
      const timer = setTimeout(() => {
        this.#offlineTimers.delete(conn.userId);
        if (!this.#users.has(conn.userId)) {
          this.#toFriends(conn.userId, { t: 'presence', userId: conn.userId, online: false });
        }
      }, OFFLINE_DEBOUNCE_MS);
      this.#offlineTimers.set(conn.userId, timer.unref());
    }

    const call = this.#callFor(conn.userId);
    if (call) {
      const side = this.#sideOf(call, conn.userId);
      if (side.connId === conn.id && !side.grace) {
        side.grace = setTimeout(() => this.#endCall(call, 'lost'), GRACE_MS);
      }
    }
  }

  #beat() {
    for (const conns of this.#users.values()) {
      for (const conn of conns.values()) {
        if (!conn.alive) {
          conn.ws.terminate();
          continue;
        }
        conn.alive = false;
        conn.ws.ping();
      }
    }
  }

  #allow(conn: Conn) {
    const now = Date.now();
    if (now >= conn.budgetReset) {
      conn.budget = 0;
      conn.budgetReset = now + RATE_WINDOW_MS;
    }
    return ++conn.budget <= RATE_MAX;
  }

  #send(conn: Conn, msg: object) {
    if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(JSON.stringify(msg));
  }

  #toUser(userId: number, msg: object, exceptConnId?: string) {
    const conns = this.#users.get(userId);
    if (!conns) return;
    const data = JSON.stringify(msg);
    for (const conn of conns.values()) {
      if (conn.id !== exceptConnId && conn.ws.readyState === conn.ws.OPEN) conn.ws.send(data);
    }
  }

  #toFriends(userId: number, msg: object) {
    for (const id of this.#db.friendIds(userId)) this.#toUser(id, msg);
  }

  // ---- message handling ----

  #handle(conn: Conn, m: Incoming) {
    switch (m.t) {
      case 'ping':
        return this.#send(conn, { t: 'pong' });
      case 'msg:send':
        return this.#onMessage(conn, m);
      case 'msg:read':
        return this.#onRead(conn, m);
      case 'typing': {
        const to = int(m.to);
        if (to && this.#db.areFriends(conn.userId, to)) this.#toUser(to, { t: 'typing', from: conn.userId });
        return;
      }
      case 'call:invite':
        return this.#onInvite(conn, m);
      case 'call:accept':
        return this.#onAccept(conn, m);
      case 'call:reject':
        return this.#onReject(conn, m);
      case 'call:hangup':
        return this.#onHangup(conn, m);
      case 'call:resume':
        return this.#onResume(conn, m);
      case 'rtc':
        return this.#onRtc(conn, m);
    }
  }

  #onMessage(conn: Conn, m: Incoming) {
    const to = int(m.to);
    const cid = str(m.cid);
    if (!to || !ID_RE.test(cid)) return;
    const body = str(m.body).trim();
    if (!body || body.length > MAX_BODY) return this.#send(conn, { t: 'msg:error', cid, error: 'invalid_body' });
    if (!this.#db.areFriends(conn.userId, to)) return this.#send(conn, { t: 'msg:error', cid, error: 'not_friends' });

    const { message, created } = this.#db.insertMessage(conn.userId, to, cid, body, Date.now());
    this.#send(conn, { t: 'msg:ack', cid, message });
    if (created) {
      this.#toUser(to, { t: 'msg:new', message });
      this.#toUser(conn.userId, { t: 'msg:new', message }, conn.id);
    }
  }

  #onRead(conn: Conn, m: Incoming) {
    const peer = int(m.peer);
    const upTo = int(m.upTo);
    if (!peer || !upTo || !this.#db.areFriends(conn.userId, peer)) return;
    if (this.#db.markRead(conn.userId, peer, upTo, Date.now()) === 0) return;
    const event = { t: 'msg:read', reader: conn.userId, peer, upTo };
    this.#toUser(peer, event);
    this.#toUser(conn.userId, event, conn.id);
  }

  // ---- calls ----

  #onInvite(conn: Conn, m: Incoming) {
    const to = int(m.to);
    const callId = str(m.callId);
    if (!to || !ID_RE.test(callId) || this.#calls.has(callId)) return;
    const end = (reason: string) => this.#send(conn, { t: 'call:end', callId, reason });
    if (!this.#db.areFriends(conn.userId, to)) return end('forbidden');
    if (this.#callOf.has(conn.userId)) return end('busy_self');
    if (this.#callOf.has(to)) return end('busy');
    if (!this.#users.has(to)) return end('offline');

    const call: Call = {
      id: callId,
      kind: m.kind === 'video' ? 'video' : 'audio',
      state: 'ringing',
      caller: { userId: conn.userId, connId: conn.id, grace: null },
      callee: { userId: to, connId: null, grace: null },
      ring: null,
    };
    call.ring = setTimeout(() => this.#endCall(call, 'timeout'), RING_MS);
    this.#calls.set(callId, call);
    this.#callOf.set(conn.userId, callId);
    this.#callOf.set(to, callId);
    this.#toUser(to, { t: 'call:incoming', callId, from: conn.userId, kind: call.kind });
    this.#send(conn, { t: 'call:ringing', callId });
  }

  #onAccept(conn: Conn, m: Incoming) {
    const call = this.#calls.get(str(m.callId));
    if (!call || call.state !== 'ringing' || call.callee.userId !== conn.userId) {
      return this.#send(conn, { t: 'call:end', callId: str(m.callId), reason: 'gone' });
    }
    call.state = 'active';
    call.callee.connId = conn.id;
    if (call.ring) clearTimeout(call.ring);
    call.ring = null;
    this.#sendSide(call.caller, { t: 'call:accepted', callId: call.id });
    // Stop ringing on the callee's other devices.
    this.#toUser(conn.userId, { t: 'call:taken', callId: call.id }, conn.id);
  }

  #onReject(conn: Conn, m: Incoming) {
    const call = this.#calls.get(str(m.callId));
    if (call && call.state === 'ringing' && call.callee.userId === conn.userId) this.#endCall(call, 'rejected');
  }

  #onHangup(conn: Conn, m: Incoming) {
    const call = this.#calls.get(str(m.callId));
    if (!call || !this.#isParty(call, conn.userId)) return;
    if (call.state === 'active') return this.#endCall(call, 'hangup');
    this.#endCall(call, call.caller.userId === conn.userId ? 'cancelled' : 'rejected');
  }

  /** A client reconnected its WebSocket mid-call and wants the call bound to the new connection. */
  #onResume(conn: Conn, m: Incoming) {
    const call = this.#calls.get(str(m.callId));
    if (!call || !this.#isParty(call, conn.userId)) {
      return this.#send(conn, { t: 'call:end', callId: str(m.callId), reason: 'gone' });
    }
    const side = this.#sideOf(call, conn.userId);
    if (side.connId === null) return;
    side.connId = conn.id;
    if (side.grace) clearTimeout(side.grace);
    side.grace = null;
    this.#send(conn, { t: 'call:resumed', callId: call.id, state: call.state });
    if (call.state === 'active') this.#sendSide(this.#otherSide(call, side), { t: 'call:peer-back', callId: call.id });
  }

  /** WebRTC offer/answer/ICE candidates and media-state flags, relayed verbatim to the other party. */
  #onRtc(conn: Conn, m: Incoming) {
    const call = this.#calls.get(str(m.callId));
    if (!call || call.state !== 'active' || !this.#isParty(call, conn.userId)) return;
    const side = this.#sideOf(call, conn.userId);
    if (side.connId !== conn.id || !m.data || typeof m.data !== 'object') return;
    this.#sendSide(this.#otherSide(call, side), { t: 'rtc', callId: call.id, data: m.data });
  }

  #endCall(call: Call, reason: string) {
    if (this.#calls.get(call.id) !== call) return;
    this.#calls.delete(call.id);
    if (call.ring) clearTimeout(call.ring);
    for (const side of [call.caller, call.callee]) {
      if (side.grace) clearTimeout(side.grace);
      if (this.#callOf.get(side.userId) === call.id) this.#callOf.delete(side.userId);
    }
    const event = { t: 'call:end', callId: call.id, reason };
    this.#sendSide(call.caller, event);
    if (call.callee.connId) this.#sendSide(call.callee, event);
    else this.#toUser(call.callee.userId, event);
  }

  #callFor(userId: number) {
    const id = this.#callOf.get(userId);
    return id ? this.#calls.get(id) : undefined;
  }

  #isParty(call: Call, userId: number) {
    return call.caller.userId === userId || call.callee.userId === userId;
  }

  #sideOf(call: Call, userId: number) {
    return call.caller.userId === userId ? call.caller : call.callee;
  }

  #otherSide(call: Call, side: Side) {
    return side === call.caller ? call.callee : call.caller;
  }

  #sendSide(side: Side, msg: object) {
    const conn = side.connId ? this.#users.get(side.userId)?.get(side.connId) : undefined;
    if (conn) this.#send(conn, msg);
  }
}
