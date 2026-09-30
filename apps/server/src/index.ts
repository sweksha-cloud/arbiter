import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { connectWithRetry, createDb, createPool } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { PostgresSessionHistory } from './history/postgres-session-history.js';
import { PostgresGuestStore } from './identity/postgres-guest-store.js';

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const db = createDb(pool);
const { http } = await buildApp({
  webOrigin: config.WEB_ORIGIN,
  logLevel: config.LOG_LEVEL,
  guests: new PostgresGuestStore(db),
  history: new PostgresSessionHistory(db)
});
http.addHook('onClose', async () => {
  await pool.end();
});

await connectWithRetry(pool, {
  onRetry: (error, attempt) => http.log.warn({ err: error, attempt }, 'Database connection failed, retrying')
});
await runMigrations(db);

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
