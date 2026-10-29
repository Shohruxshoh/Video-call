import { loadConfig } from './config.ts';
import { buildApp } from './app.ts';

const cfg = loadConfig();
const app = await buildApp(cfg);
await app.listen({ host: cfg.host, port: cfg.port });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.close().then(() => process.exit(0));
  });
}
