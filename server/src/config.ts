import { fileURLToPath } from 'node:url';

export interface Config {
  host: string;
  port: number;
  dbPath: string;
  publicUrl: string;
  allowedOrigins: string[];
  allowLoopbackOrigins: boolean;
  secureCookies: boolean;
  trustProxy: boolean;
  logLevel: string;
  turnSecret: string;
  turnHost: string;
  /** Also offer TURN over TLS on 5349 (only if coturn is configured with a certificate). */
  turnTls: boolean;
  stunUrls: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production';
  const publicUrl = (env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
  const extraOrigins = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const turnHost = env.TURN_HOST ?? '';

  return {
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 3210),
    dbPath: env.DB_PATH ?? fileURLToPath(new URL('../data/app.db', import.meta.url)),
    publicUrl,
    allowedOrigins: [...new Set([new URL(publicUrl).origin, ...extraOrigins])],
    // In development accept any loopback page (localhost, 127.0.0.1, app.localhost, …), so several
    // browser tabs with separate cookie jars can play different users.
    allowLoopbackOrigins: !production,
    secureCookies: production,
    trustProxy: production || env.TRUST_PROXY === '1',
    logLevel: env.LOG_LEVEL ?? 'info',
    turnSecret: env.TURN_SECRET ?? '',
    turnHost,
    turnTls: env.TURN_TLS === '1',
    // Our own coturn also answers STUN; without it fall back to a free public STUN server.
    stunUrls: turnHost ? [`stun:${turnHost}:3478`] : ['stun:stun.l.google.com:19302'],
  };
}
