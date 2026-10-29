import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import type { Config } from './config.ts';
import { type PublicUser, openDb } from './db.ts';
import { Hub } from './hub.ts';
import { type Ctx, requireUser } from './context.ts';
import { authRoutes } from './routes/auth.ts';
import { socialRoutes } from './routes/social.ts';

function isLoopback(origin: string) {
  try {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost');
  } catch {
    return false;
  }
}

export async function buildApp(cfg: Config) {
  const db = openDb(cfg.dbPath);
  const hub = new Hub(db);
  const ctx: Ctx = { cfg, db, hub };

  const app = Fastify({ logger: { level: cfg.logLevel }, trustProxy: cfg.trustProxy, bodyLimit: 64 * 1024 });
  // Filled in by requireUser(); declared up front so every request object has the same shape.
  app.decorateRequest('user', null as unknown as PublicUser);
  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  // The session cookie rides along on cross-site requests too, so refuse state-changing
  // requests and WebSocket upgrades coming from pages that aren't ours (CSRF / socket hijacking).
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (!origin || cfg.allowedOrigins.includes(origin) || (cfg.allowLoopbackOrigins && isLoopback(origin))) return;
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.headers.upgrade) {
      return reply.code(403).send({ error: 'bad_origin' });
    }
  });

  app.get('/ws', { websocket: true, preValidation: requireUser(ctx) }, (socket, req) => hub.attach(socket, req.user.id));
  app.get('/api/health', async () => ({ ok: true }));
  authRoutes(app, ctx);
  socialRoutes(app, ctx);

  const purge = setInterval(() => db.purgeExpired(Date.now()), 3600_000).unref();
  app.addHook('onClose', async () => {
    clearInterval(purge);
    hub.close();
    db.close();
  });
  return app;
}
