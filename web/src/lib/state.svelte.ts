import { ApiError, api } from './api';
import { socket, type ServerMsg } from './socket.svelte';
import { errorText } from './text';
import { randomId, storage } from './util';
import { showNotification } from './notify';

export interface User {
  id: number;
  username: string;
  displayName: string;
}

export interface Message {
  /** 0 while the message is still waiting in the outbox. */
  id: number;
  cid: string;
  from: number;
  to: number;
  body: string;
  at: number;
  readAt: number | null;
  pending?: boolean;
  error?: string;
}

export interface Friend {
  id: number;
  username: string;
  displayName: string;
  since: number;
  online: boolean;
  unread: number;
  /** Highest id of my messages this friend has read. */
  peerRead: number;
  last: { id: number; from: number; body: string; at: number } | null;
}

export interface Invite {
  token: string;
  url: string;
  createdAt: number;
  expiresAt: number;
}

interface Conversation {
  messages: Message[];
  loaded: boolean;
  loading: boolean;
  hasMore: boolean;
}

const TYPING_SHOW_MS = 5_000;
const TYPING_SEND_MS = 3_000;

const byId = (a: Message, b: Message) => (a.id || Infinity) - (b.id || Infinity) || a.at - b.at;

class AppState {
  me = $state<User | null>(null);
  booting = $state(true);
  friends = $state<Friend[]>([]);
  activeId = $state<number | null>(null);
  convs = $state<Record<number, Conversation>>({});
  typing = $state<Record<number, boolean>>({});
  notice = $state('');

  #outbox: Message[] = [];
  #lastId = 0;
  #readSent: Record<number, number> = {};
  #typingTimers = new Map<number, number>();
  #typingSentAt = 0;
  #noticeTimer = 0;
  #unsubscribe: (() => void) | null = null;

  get active() {
    return this.friends.find((f) => f.id === this.activeId) ?? null;
  }

  get totalUnread() {
    return this.friends.reduce((n, f) => n + f.unread, 0);
  }

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.activeId) this.markRead(this.activeId);
    });
  }

  // ---- session ----

  async boot() {
    try {
      const { user } = await api<{ user: User }>('GET', '/api/me');
      this.#start(user);
    } catch (err) {
      // Offline start: show cached friends, the socket keeps retrying in the background.
      const cached = storage.get<User>('me');
      if (err instanceof ApiError && err.status === 0 && cached) this.#start(cached);
    } finally {
      this.booting = false;
    }
  }

  async login(username: string, password: string) {
    const { user } = await api<{ user: User }>('POST', '/api/auth/login', { username, password });
    this.#start(user);
  }

  async register(username: string, displayName: string, password: string) {
    const { user } = await api<{ user: User }>('POST', '/api/auth/register', { username, displayName, password });
    this.#start(user);
  }

  async logout() {
    await api('POST', '/api/auth/logout').catch(() => {});
    this.#end();
  }

  #start(user: User) {
    this.me = user;
    storage.set('me', user);
    this.#outbox = storage.get<Message[]>(`outbox:${user.id}`) ?? [];
    this.friends = storage.get<Friend[]>(`friends:${user.id}`) ?? [];
    this.#lastId = Math.max(0, ...this.friends.map((f) => f.last?.id ?? 0));
    this.#unsubscribe ??= socket.on((m) => this.#onSocket(m));
    socket.start();
    this.loadFriends().catch(() => {});
  }

  #end() {
    socket.stop();
    storage.remove('me');
    this.me = null;
    this.friends = [];
    this.convs = {};
    this.activeId = null;
    this.#outbox = [];
    this.#readSent = {};
  }

  // ---- friends & invites ----

  async loadFriends() {
    const { friends } = await api<{ friends: Friend[] }>('GET', '/api/friends');
    this.friends = friends;
    for (const f of friends) if (f.last) this.#lastId = Math.max(this.#lastId, f.last.id);
    this.#cacheFriends();
  }

  async removeFriend(id: number) {
    await api('DELETE', `/api/friends/${id}`);
    this.#dropFriend(id);
  }

  createInvite = () => api<{ invite: Invite }>('POST', '/api/invites').then((r) => r.invite);
  listInvites = () => api<{ invites: Invite[] }>('GET', '/api/invites').then((r) => r.invites);
  revokeInvite = (token: string) => api('DELETE', `/api/invites/${encodeURIComponent(token)}`);
  inviteInfo = (token: string) =>
    api<{ inviter: { displayName: string }; own: boolean; alreadyFriends: boolean }>(
      'GET',
      `/api/invite/${encodeURIComponent(token)}`,
    );

  async acceptInvite(token: string) {
    const { friend } = await api<{ friend: Friend }>('POST', `/api/invite/${encodeURIComponent(token)}/accept`);
    if (friend) this.#upsertFriend(friend);
    return friend;
  }

  #upsertFriend(friend: Friend) {
    const existing = this.friends.find((f) => f.id === friend.id);
    if (existing) Object.assign(existing, friend);
    else this.friends.unshift(friend);
    this.#cacheFriends();
  }

  #dropFriend(id: number) {
    this.friends = this.friends.filter((f) => f.id !== id);
    delete this.convs[id];
    if (this.activeId === id) this.activeId = null;
    this.#outbox = this.#outbox.filter((m) => m.to !== id);
    this.#saveOutbox();
    this.#cacheFriends();
  }

  #cacheFriends() {
    if (this.me) storage.set(`friends:${this.me.id}`, $state.snapshot(this.friends));
  }

  // ---- conversations ----

  #conv(peer: number) {
    this.convs[peer] ??= { messages: [], loaded: false, loading: false, hasMore: false };
    return this.convs[peer];
  }

  async openChat(peer: number) {
    this.activeId = peer;
    const conv = this.#conv(peer);
    if (!conv.loaded) await this.loadHistory(peer);
    this.markRead(peer);
  }

  async loadHistory(peer: number, older = false) {
    const conv = this.#conv(peer);
    if (conv.loading) return;
    conv.loading = true;
    try {
      const oldest = conv.messages.find((m) => m.id)?.id;
      const query = older && oldest ? `?before=${oldest}` : '';
      const r = await api<{ messages: Message[]; hasMore: boolean }>('GET', `/api/messages/${peer}${query}`);
      const known = new Set(conv.messages.map((m) => m.id).filter(Boolean));
      const fresh = r.messages.filter((m) => !known.has(m.id));
      const queued = conv.loaded ? [] : this.#outbox.filter((m) => m.to === peer && !conv.messages.some((x) => x.cid === m.cid));
      conv.messages = [...fresh, ...conv.messages, ...queued].sort(byId);
      conv.hasMore = r.hasMore;
      conv.loaded = true;
      for (const m of r.messages) this.#lastId = Math.max(this.#lastId, m.id);
    } catch (err) {
      this.flash(errorText(err instanceof ApiError ? err.code : 'unknown'));
    } finally {
      conv.loading = false;
    }
  }

  send(peer: number, text: string) {
    const body = text.trim();
    if (!body || !this.me) return;
    const msg: Message = {
      id: 0,
      cid: randomId(),
      from: this.me.id,
      to: peer,
      body,
      at: Date.now(),
      readAt: null,
      pending: true,
    };
    this.#outbox.push(msg);
    this.#saveOutbox();
    this.#conv(peer).messages.push({ ...msg });
    const friend = this.friends.find((f) => f.id === peer);
    if (friend) {
      friend.last = { id: 0, from: msg.from, body, at: msg.at };
      this.#bump(friend);
    }
    socket.send({ t: 'msg:send', to: peer, cid: msg.cid, body });
  }

  markRead(peer: number) {
    const friend = this.friends.find((f) => f.id === peer);
    if (!friend || document.visibilityState !== 'visible' || this.activeId !== peer) return;
    const fromPeer = (this.convs[peer]?.messages ?? []).filter((m) => m.from === peer && m.id);
    const upTo = Math.max(fromPeer.at(-1)?.id ?? 0, friend.last?.from === peer ? friend.last.id : 0);
    friend.unread = 0;
    if (!upTo || upTo <= (this.#readSent[peer] ?? 0)) return;
    if (socket.send({ t: 'msg:read', peer, upTo })) this.#readSent[peer] = upTo;
  }

  typed(peer: number) {
    const now = Date.now();
    if (now - this.#typingSentAt < TYPING_SEND_MS) return;
    this.#typingSentAt = now;
    socket.send({ t: 'typing', to: peer });
  }

  flash(text: string) {
    this.notice = text;
    clearTimeout(this.#noticeTimer);
    this.#noticeTimer = setTimeout(() => (this.notice = ''), 4500);
  }

  // ---- realtime events ----

  #onSocket(m: ServerMsg) {
    switch (m.t) {
      case 'hello':
        return void this.#onHello(m.online as number[]);
      case '_closed':
        if (m.failures >= 3) void this.#checkSession();
        return;
      case 'presence': {
        const friend = this.friends.find((f) => f.id === m.userId);
        if (friend) friend.online = m.online;
        return;
      }
      case 'friend:new':
        this.#upsertFriend(m.friend);
        return this.flash(`${m.friend.displayName} endi do'stingiz`);
      case 'friend:removed':
        return this.#dropFriend(m.userId);
      case 'msg:new':
        return this.#receive(m.message);
      case 'msg:ack':
        return this.#ack(m.cid, m.message);
      case 'msg:error':
        return this.#fail(m.cid, m.error);
      case 'msg:read':
        return this.#onRead(m.reader, m.peer, m.upTo);
      case 'typing':
        return this.#onTyping(m.from);
    }
  }

  async #onHello(online: number[]) {
    const set = new Set(online);
    for (const f of this.friends) f.online = set.has(f.id);
    this.#readSent = {};
    for (const msg of this.#outbox) socket.send({ t: 'msg:send', to: msg.to, cid: msg.cid, body: msg.body });
    try {
      // Fill gaps in open conversations, then refresh counters and previews.
      if (Object.values(this.convs).some((c) => c.loaded)) {
        let since = this.#lastId;
        for (let page = 0; page < 5; page++) {
          const r = await api<{ messages: Message[]; hasMore: boolean }>('GET', `/api/sync?since=${since}`);
          for (const msg of r.messages) this.#insert(msg);
          since = r.messages.at(-1)?.id ?? since;
          if (!r.hasMore) break;
        }
      }
      await this.loadFriends();
      if (this.activeId) this.markRead(this.activeId);
    } catch {
      /* next reconnect will try again */
    }
  }

  async #checkSession() {
    try {
      await api('GET', '/api/me');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) this.#end();
    }
  }

  #peerOf(msg: Message) {
    return msg.from === this.me?.id ? msg.to : msg.from;
  }

  /** Adds a server message to its conversation if that conversation is loaded. Returns false for duplicates. */
  #insert(msg: Message) {
    this.#lastId = Math.max(this.#lastId, msg.id);
    const conv = this.convs[this.#peerOf(msg)];
    if (!conv?.loaded) return true;
    if (conv.messages.some((m) => m.id === msg.id)) return false;
    const pendingIdx = conv.messages.findIndex((m) => m.from === msg.from && m.cid === msg.cid);
    if (pendingIdx >= 0) conv.messages[pendingIdx] = msg;
    else conv.messages.push(msg);
    conv.messages.sort(byId);
    return true;
  }

  #receive(msg: Message) {
    const peer = this.#peerOf(msg);
    const friend = this.friends.find((f) => f.id === peer);
    if (!friend) return;
    const isNew = !friend.last || !friend.last.id || msg.id > friend.last.id;
    if (!this.#insert(msg) || !isNew) return;
    friend.last = { id: msg.id, from: msg.from, body: msg.body, at: msg.at };
    this.#bump(friend);
    if (msg.from === peer) {
      this.#onTyping(peer, true);
      if (this.activeId === peer && document.visibilityState === 'visible') this.markRead(peer);
      else {
        friend.unread++;
        void showNotification(friend.displayName, msg.body, `msg-${peer}`);
      }
    }
    this.#cacheFriends();
  }

  #ack(cid: string, msg: Message) {
    this.#outbox = this.#outbox.filter((m) => m.cid !== cid);
    this.#saveOutbox();
    this.#insert(msg);
    const friend = this.friends.find((f) => f.id === msg.to);
    if (friend && (!friend.last || !friend.last.id || friend.last.id <= msg.id)) {
      friend.last = { id: msg.id, from: msg.from, body: msg.body, at: msg.at };
      this.#cacheFriends();
    }
  }

  #fail(cid: string, error: string) {
    const failed = this.#outbox.find((m) => m.cid === cid);
    this.#outbox = this.#outbox.filter((m) => m.cid !== cid);
    this.#saveOutbox();
    const msg = failed && this.convs[failed.to]?.messages.find((m) => m.cid === cid);
    if (msg) {
      msg.pending = false;
      msg.error = errorText(error);
    }
  }

  #onRead(reader: number, peer: number, upTo: number) {
    if (reader === this.me?.id) {
      // Read on another of my devices.
      const friend = this.friends.find((f) => f.id === peer);
      if (friend && (!friend.last || friend.last.id <= upTo)) friend.unread = 0;
    } else {
      const friend = this.friends.find((f) => f.id === reader);
      if (friend) friend.peerRead = Math.max(friend.peerRead, upTo);
    }
  }

  #onTyping(from: number, stop = false) {
    clearTimeout(this.#typingTimers.get(from));
    if (stop) {
      delete this.typing[from];
      return;
    }
    this.typing[from] = true;
    this.#typingTimers.set(
      from,
      setTimeout(() => delete this.typing[from], TYPING_SHOW_MS),
    );
  }

  #bump(friend: Friend) {
    const idx = this.friends.indexOf(friend);
    if (idx > 0) {
      this.friends.splice(idx, 1);
      this.friends.unshift(friend);
    }
  }

  #saveOutbox() {
    if (this.me) storage.set(`outbox:${this.me.id}`, this.#outbox);
  }
}

export const app = new AppState();
