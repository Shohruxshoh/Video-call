import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { loadConfig } from '../src/config.ts';
import { buildApp } from '../src/app.ts';

type Json = Record<string, any>;

const dir = mkdtempSync(join(tmpdir(), 'onlinevideo-test-'));
let app: Awaited<ReturnType<typeof buildApp>>;
let base = '';

before(async () => {
  app = await buildApp(loadConfig({ DB_PATH: join(dir, 'test.db'), LOG_LEVEL: 'silent' }));
  await app.listen({ host: '127.0.0.1', port: 0 });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

after(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

class TestSocket {
  received: Json[] = [];
  ws: WebSocket;

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (data) => this.received.push(JSON.parse(String(data))));
  }

  send(msg: Json) {
    this.ws.send(JSON.stringify(msg));
  }

  async waitFor(match: (m: Json) => boolean, ms = 2000): Promise<Json> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const found = this.received.find(match);
      if (found) return found;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('timed out waiting for message');
  }

  /** Asserts that nothing matching arrives within `ms`. */
  async never(match: (m: Json) => boolean, ms = 300) {
    await new Promise((r) => setTimeout(r, ms));
    assert.equal(this.received.find(match), undefined);
  }
}

class Client {
  cookie = '';
  id = 0;

  async req(method: string, path: string, body?: Json, headers: Record<string, string> = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), cookie: this.cookie, ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    return { status: res.status, body: (await res.json().catch(() => null)) as Json };
  }

  async register(username: string) {
    const r = await this.req('POST', '/api/auth/register', { username, displayName: username, password: 'test-password-1' });
    assert.equal(r.status, 200);
    this.id = r.body.user.id;
    return this;
  }

  socket(): Promise<TestSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, { headers: { cookie: this.cookie } });
      const socket = new TestSocket(ws);
      ws.once('open', () => resolve(socket));
      ws.once('error', reject);
    });
  }
}

const men = new Client();
const ali = new Client();
const vali = new Client();
let aliInvite = '';

test('register three users', async () => {
  await men.register('men');
  await ali.register('ali');
  await vali.register('vali');
  const dup = await new Client().req('POST', '/api/auth/register', {
    username: 'ALI',
    displayName: 'x',
    password: 'test-password-1',
  });
  assert.equal(dup.status, 409);
});

test('friendship only through invite links', async () => {
  const inv1 = await men.req('POST', '/api/invites');
  aliInvite = inv1.body.invite.token;
  const info = await ali.req('GET', `/api/invite/${aliInvite}`);
  assert.equal(info.body.inviter.displayName, 'men');
  const ownAccept = await men.req('POST', `/api/invite/${aliInvite}/accept`);
  assert.equal(ownAccept.status, 400);
  assert.equal((await ali.req('POST', `/api/invite/${aliInvite}/accept`)).status, 200);
  // Retrying the same accept is harmless.
  assert.equal((await ali.req('POST', `/api/invite/${aliInvite}/accept`)).status, 200);

  const inv2 = await men.req('POST', '/api/invites');
  assert.equal((await vali.req('POST', `/api/invite/${inv2.body.invite.token}/accept`)).status, 200);
});

test('invite links are single-use', async () => {
  assert.equal((await vali.req('GET', `/api/invite/${aliInvite}`)).status, 404);
  assert.equal((await vali.req('POST', `/api/invite/${aliInvite}/accept`)).status, 404);
});

test('friends lists: ali and vali only see men', async () => {
  const names = async (c: Client) => (await c.req('GET', '/api/friends')).body.friends.map((f: Json) => f.username).sort();
  assert.deepEqual(await names(men), ['ali', 'vali']);
  assert.deepEqual(await names(ali), ['men']);
  assert.deepEqual(await names(vali), ['men']);
});

test('no history access between non-friends', async () => {
  assert.equal((await ali.req('GET', `/api/messages/${vali.id}`)).status, 404);
  assert.equal((await ali.req('GET', `/api/messages/${men.id}`)).status, 200);
  assert.equal((await new Client().req('GET', `/api/messages/${men.id}`)).status, 401);
});

test('realtime: presence, messages and calls respect friendships', async () => {
  const menWs = await men.socket();
  const valiWs = await vali.socket();
  const aliWs = await ali.socket();

  const aliHello = await aliWs.waitFor((m) => m.t === 'hello');
  assert.deepEqual(aliHello.online, [men.id], 'ali must not learn that vali is online');
  await menWs.waitFor((m) => m.t === 'presence' && m.userId === ali.id && m.online);
  await valiWs.never((m) => m.t === 'presence' && m.userId === ali.id);

  // ali -> vali is refused and never delivered
  aliWs.send({ t: 'msg:send', to: vali.id, cid: 'cid-forbidden-1', body: 'salom vali' });
  const err = await aliWs.waitFor((m) => m.t === 'msg:error' && m.cid === 'cid-forbidden-1');
  assert.equal(err.error, 'not_friends');
  await valiWs.never((m) => m.t === 'msg:new');

  // ali -> men is delivered once even if resent
  aliWs.send({ t: 'msg:send', to: men.id, cid: 'cid-hello-0001', body: 'salom men' });
  aliWs.send({ t: 'msg:send', to: men.id, cid: 'cid-hello-0001', body: 'salom men' });
  const delivered = await menWs.waitFor((m) => m.t === 'msg:new');
  assert.equal(delivered.message.body, 'salom men');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(menWs.received.filter((m) => m.t === 'msg:new').length, 1);

  // men -> vali
  menWs.send({ t: 'msg:send', to: vali.id, cid: 'cid-to-vali-01', body: 'salom vali' });
  await valiWs.waitFor((m) => m.t === 'msg:new' && m.message.body === 'salom vali');

  // sync never includes conversations ali isn't part of
  const sync = await ali.req('GET', '/api/sync?since=0');
  assert.deepEqual(sync.body.messages.map((m: Json) => m.body), ['salom men']);

  // read receipts reach the sender
  menWs.send({ t: 'msg:read', peer: ali.id, upTo: delivered.message.id });
  await aliWs.waitFor((m) => m.t === 'msg:read' && m.reader === men.id && m.upTo === delivered.message.id);

  // ali cannot call vali
  aliWs.send({ t: 'call:invite', to: vali.id, callId: 'call-forbidden-1', kind: 'video' });
  const refused = await aliWs.waitFor((m) => m.t === 'call:end' && m.callId === 'call-forbidden-1');
  assert.equal(refused.reason, 'forbidden');
  await valiWs.never((m) => m.t === 'call:incoming');

  // men <-> ali call: ring, accept, relay, hang up
  menWs.send({ t: 'call:invite', to: ali.id, callId: 'call-men-ali-1', kind: 'audio' });
  await menWs.waitFor((m) => m.t === 'call:ringing');
  const incoming = await aliWs.waitFor((m) => m.t === 'call:incoming');
  assert.equal(incoming.from, men.id);

  // vali calling men while men is busy
  valiWs.send({ t: 'call:invite', to: men.id, callId: 'call-vali-men-1', kind: 'audio' });
  assert.equal((await valiWs.waitFor((m) => m.callId === 'call-vali-men-1')).reason, 'busy');

  aliWs.send({ t: 'call:accept', callId: 'call-men-ali-1' });
  await menWs.waitFor((m) => m.t === 'call:accepted');
  menWs.send({ t: 'rtc', callId: 'call-men-ali-1', data: { sdp: { type: 'offer', sdp: 'x' } } });
  const relayed = await aliWs.waitFor((m) => m.t === 'rtc');
  assert.equal(relayed.data.sdp.type, 'offer');
  // vali cannot inject signaling into a call they're not part of
  valiWs.send({ t: 'rtc', callId: 'call-men-ali-1', data: { sdp: { type: 'offer', sdp: 'evil' } } });
  await aliWs.never((m) => m.t === 'rtc' && m.data.sdp?.sdp === 'evil');

  aliWs.send({ t: 'call:hangup', callId: 'call-men-ali-1' });
  assert.equal((await menWs.waitFor((m) => m.t === 'call:end' && m.callId === 'call-men-ali-1')).reason, 'hangup');

  // unfriending cuts messaging immediately
  assert.equal((await men.req('DELETE', `/api/friends/${ali.id}`)).status, 200);
  await aliWs.waitFor((m) => m.t === 'friend:removed' && m.userId === men.id);
  aliWs.send({ t: 'msg:send', to: men.id, cid: 'cid-after-unfriend', body: 'hey' });
  assert.equal((await aliWs.waitFor((m) => m.cid === 'cid-after-unfriend')).error, 'not_friends');

  for (const s of [menWs, valiWs, aliWs]) s.ws.close();
});

test('cross-site requests are refused', async () => {
  const r = await men.req('POST', '/api/invites', undefined, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, {
    headers: { cookie: men.cookie, origin: 'https://evil.example' },
  });
  await new Promise<void>((resolve) => {
    ws.once('unexpected-response', (_req, res) => {
      assert.equal(res.statusCode, 403);
      resolve();
    });
    ws.once('open', () => assert.fail('cross-site socket must not open'));
  });
});
