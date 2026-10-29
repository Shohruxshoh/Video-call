import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.ts';
import type { Db, PublicUser } from './db.ts';
import type { Hub } from './hub.ts';
import { sha256 } from './crypto.ts';

declare module 'fastify' {
  interface FastifyRequest {
    user: PublicUser;
  }
}

export interface Ctx {
  cfg: Config;
  db: Db;
  hub: Hub;
}

export const SESSION_COOKIE = 'sid';

export function sessionUser(ctx: Ctx, req: FastifyRequest): PublicUser | undefined {
  const token = req.cookies[SESSION_COOKIE];
  return token ? ctx.db.userBySession(sha256(token), Date.now()) : undefined;
}

/** Route hook: rejects with 401 unless the request carries a valid session, then sets `req.user`. */
export function requireUser(ctx: Ctx) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const user = sessionUser(ctx, req);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    req.user = user;
  };
}

export const str = (value: unknown) => (typeof value === 'string' ? value : '');

/** Positive integer id or 0. */
export const int = (value: unknown) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
};
