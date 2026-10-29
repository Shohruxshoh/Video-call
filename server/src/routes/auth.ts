import type { FastifyInstance, FastifyReply } from 'fastify';
import { DUMMY_HASH, hashPassword, randomToken, sha256, verifyPassword } from '../crypto.ts';
import { RateLimiter } from '../ratelimit.ts';
import { type Ctx, SESSION_COOKIE, requireUser, str } from '../context.ts';

const SESSION_MS = 180 * 24 * 3600 * 1000;
const USERNAME_RE = /^[a-zA-Z0-9_.]{3,24}$/;

export function authRoutes(app: FastifyInstance, ctx: Ctx) {
  // Mobile carriers put many people behind one IP (CGNAT), so the per-IP budget is generous
  // and brute force is limited per IP + username instead.
  const perIp = new RateLimiter(200, 10 * 60_000);
  const perAccount = new RateLimiter(10, 10 * 60_000);
  const registrations = new RateLimiter(20, 60 * 60_000);
  app.addHook('onClose', async () => {
    perIp.stop();
    perAccount.stop();
    registrations.stop();
  });

  function startSession(reply: FastifyReply, userId: number) {
    const token = randomToken();
    const now = Date.now();
    ctx.db.createSession(sha256(token), userId, now, now + SESSION_MS);
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: ctx.cfg.secureCookies,
      maxAge: SESSION_MS / 1000,
    });
  }

  app.post('/api/auth/register', async (req, reply) => {
    if (!registrations.take(req.ip)) return reply.code(429).send({ error: 'rate_limited' });
    const body = (req.body ?? {}) as Record<string, unknown>;
    const username = str(body.username).trim();
    const displayName = str(body.displayName).trim().replace(/\s+/g, ' ');
    const password = str(body.password);
    if (!USERNAME_RE.test(username)) return reply.code(400).send({ error: 'invalid_username' });
    if (displayName.length < 1 || displayName.length > 40) {
      return reply.code(400).send({ error: 'invalid_display_name' });
    }
    if (password.length < 8 || password.length > 200) return reply.code(400).send({ error: 'weak_password' });

    const id = ctx.db.createUser(username, displayName, await hashPassword(password), Date.now());
    if (id === null) return reply.code(409).send({ error: 'username_taken' });
    startSession(reply, id);
    return { user: ctx.db.userById(id) };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const username = str(body.username).trim();
    const password = str(body.password);
    if (!perIp.take(req.ip) || !perAccount.take(`${req.ip}:${username.toLowerCase()}`)) {
      return reply.code(429).send({ error: 'rate_limited' });
    }
    const row = username ? ctx.db.userByUsername(username) : undefined;
    const ok = await verifyPassword(password, row?.passHash ?? DUMMY_HASH);
    if (!row || !ok) return reply.code(401).send({ error: 'bad_credentials' });
    startSession(reply, row.id);
    return { user: { id: row.id, username: row.username, displayName: row.displayName } };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) ctx.db.deleteSession(sha256(token));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', { preHandler: requireUser(ctx) }, async (req) => ({ user: req.user }));
}
