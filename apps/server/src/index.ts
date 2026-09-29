import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { connectWithRetry, createPool } from './db/client.js';

const config = loadConfig();
const { http } = await buildApp({ webOrigin: config.WEB_ORIGIN, logLevel: config.LOG_LEVEL });

const pool = createPool(config.DATABASE_URL);
await connectWithRetry(pool, {
  onRetry: (error, attempt) => http.log.warn({ err: error, attempt }, 'Database connection failed, retrying')
});
http.addHook('onClose', async () => {
  await pool.end();
});

await http.listen({ host: config.HOST, port: config.PORT });

// Docker sends SIGTERM on stop and deploys; close connections cleanly.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    http.log.info({ signal }, 'Shutting down');
    http.close().then(
      () => process.exit(0),
      (error: unknown) => {
        http.log.error({ err: error }, 'Error during shutdown');
        process.exit(1);
      }
    );
  });
}
