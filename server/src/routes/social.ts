import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { randomToken } from '../crypto.ts';
import type { InviteRow } from '../db.ts';
import { RateLimiter } from '../ratelimit.ts';
import { type Ctx, int, requireUser, sessionUser } from '../context.ts';
import { toFriend } from '../views.ts';

const INVITE_MS = 7 * 24 * 3600 * 1000;
const MAX_ACTIVE_INVITES = 20;
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const TURN_TTL_S = 12 * 3600;

type TokenParams = { Params: { token: string } };
type IdParams = { Params: { id: string } };

export function socialRoutes(app: FastifyInstance, ctx: Ctx) {
  const auth = requireUser(ctx);
  const inviteLookups = new RateLimiter(60, 60_000);
  app.addHook('onClose', async () => inviteLookups.stop());

  const inviteView = (inv: Pick<InviteRow, 'token' | 'createdAt' | 'expiresAt'>) => ({
    token: inv.token,
    url: `${ctx.cfg.publicUrl}/invite/${inv.token}`,
    createdAt: inv.createdAt,
    expiresAt: inv.expiresAt,
  });

  // ---- invites (the only way to become friends) ----

  app.post('/api/invites', { preHandler: auth }, async (req, reply) => {
    const now = Date.now();
    if (ctx.db.countActiveInvites(req.user.id, now) >= MAX_ACTIVE_INVITES) {
      return reply.code(429).send({ error: 'too_many_invites' });
    }
    const token = randomToken(16);
    ctx.db.createInvite(token, req.user.id, now, now + INVITE_MS);
    return { invite: inviteView({ token, createdAt: now, expiresAt: now + INVITE_MS }) };
  });

  app.get('/api/invites', { preHandler: auth }, async (req) => ({
    invites: ctx.db.listInvites(req.user.id, Date.now()).map(inviteView),
  }));

  app.delete<TokenParams>('/api/invites/:token', { preHandler: auth }, async (req, reply) => {
    if (!ctx.db.deleteInvite(req.params.token, req.user.id)) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });

  // Public, so someone without an account yet can see who invited them before signing up.
  app.get<TokenParams>('/api/invite/:token', async (req, reply) => {
    if (!inviteLookups.take(req.ip)) return reply.code(429).send({ error: 'rate_limited' });
    const { token } = req.params;
    const inv = TOKEN_RE.test(token) ? ctx.db.inviteByToken(token) : undefined;
    const me = sessionUser(ctx, req);
    const usable = inv && inv.expiresAt > Date.now() && (inv.usedBy === null || inv.usedBy === me?.id);
    const inviter = usable ? ctx.db.userById(inv.inviterId) : undefined;
    if (!inv || !inviter) return reply.code(404).send({ error: 'invalid_invite' });
    return {
      inviter: { displayName: inviter.displayName },
      own: me?.id === inv.inviterId,
      alreadyFriends: me ? ctx.db.areFriends(me.id, inv.inviterId) : false,
    };
  });

  app.post<TokenParams>('/api/invite/:token/accept', { preHandler: auth }, async (req, reply) => {
    if (!inviteLookups.take(req.ip)) return reply.code(429).send({ error: 'rate_limited' });
    const { token } = req.params;
    if (!TOKEN_RE.test(token)) return reply.code(404).send({ error: 'invalid_invite' });
    const result = ctx.db.acceptInvite(token, req.user.id, Date.now());
    if (!result.ok) {
      return result.error === 'self'
        ? reply.code(400).send({ error: 'own_invite' })
        : reply.code(404).send({ error: 'invalid_invite' });
    }
    if (result.created) ctx.hub.friendshipCreated(result.inviterId, req.user.id);
    return { friend: ctx.hub.friendView(req.user.id, result.inviterId) };
  });

  // ---- friends ----

  app.get('/api/friends', { preHandler: auth }, async (req) => ({
    friends: ctx.db.listFriends(req.user.id).map((f) => toFriend(f, ctx.hub.isOnline(f.id))),
  }));

  app.delete<IdParams>('/api/friends/:id', { preHandler: auth }, async (req, reply) => {
    const friendId = int(req.params.id);
    if (!friendId || !ctx.db.removeFriend(req.user.id, friendId)) return reply.code(404).send({ error: 'not_found' });
    ctx.hub.friendshipRemoved(req.user.id, friendId);
    return { ok: true };
  });

  // ---- message history (sending happens over the WebSocket) ----

  app.get<IdParams & { Querystring: { before?: string; limit?: string } }>(
    '/api/messages/:id',
    { preHandler: auth },
    async (req, reply) => {
      const friendId = int(req.params.id);
      // Same answer for "no such user" and "not your friend": nothing leaks about other people.
      if (!friendId || !ctx.db.areFriends(req.user.id, friendId)) return reply.code(404).send({ error: 'not_found' });
      const before = int(req.query.before) || Number.MAX_SAFE_INTEGER;
      const limit = Math.min(int(req.query.limit) || 50, 100);
      const messages = ctx.db.conversation(req.user.id, friendId, before, limit);
      return { messages, hasMore: messages.length === limit };
    },
  );

  /** Everything newer than `since` across all friends; used after reconnecting. */
  app.get<{ Querystring: { since?: string } }>('/api/sync', { preHandler: auth }, async (req) => {
    const limit = 500;
    const messages = ctx.db.messagesSince(req.user.id, int(req.query.since), limit);
    return { messages, hasMore: messages.length === limit };
  });

  // ---- ICE servers: STUN + short-lived TURN credentials (coturn "use-auth-secret") ----

  app.get('/api/ice', { preHandler: auth }, async (req) => {
    const { turnHost, turnSecret, turnTls, stunUrls } = ctx.cfg;
    const iceServers: { urls: string[]; username?: string; credential?: string }[] = [{ urls: stunUrls }];
    if (turnHost && turnSecret) {
      const username = `${Math.floor(Date.now() / 1000) + TURN_TTL_S}:${req.user.id}`;
      const credential = createHmac('sha1', turnSecret).update(username).digest('base64');
      const urls = [`turn:${turnHost}:3478?transport=udp`, `turn:${turnHost}:3478?transport=tcp`];
      if (turnTls) urls.push(`turns:${turnHost}:5349?transport=tcp`);
      iceServers.push({ urls, username, credential });
    }
    return { iceServers, ttl: TURN_TTL_S };
  });
}
