import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The web app is built with the server at localhost:4000 (NEXT_PUBLIC_SERVER_URL's default).
export const WEB_URL = 'http://localhost:3000';
export const API_URL = 'http://localhost:4000';

const ROOT = path.resolve(import.meta.dirname, '..');
// Global setup and the tests run in different processes, so the running
// server's PID is shared through a file.
const PID_FILE = path.join(os.tmpdir(), 'arbiter-e2e-api-server.pid');
/** The server writes emails here instead of sending them (MAIL_OUTBOX_DIR). */
export const OUTBOX_DIR = path.join(os.tmpdir(), 'arbiter-e2e-outbox');

/**
 * Starts the built API server as its own process (not a Playwright webServer)
 * so the server-restart test can stop it with SIGTERM the way a deploy does.
 */
export async function startApiServer(): Promise<void> {
  const child = spawn(process.execPath, ['apps/server/dist/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: '4000',
      WEB_ORIGIN: WEB_URL,
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://arbiter:arbiter@localhost:5432/arbiter',
      // Live sessions in Redis, as in production, so they survive the restart test.
      REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
      LOG_LEVEL: 'warn',
      // The suite creates dozens of guests from one machine in seconds.
      RATE_LIMITS: 'off',
      MAIL_OUTBOX_DIR: OUTBOX_DIR
    },
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: true
  });
  child.unref();
  writeFileSync(PID_FILE, String(child.pid));
  await waitForHealth(true);
}

/** Sends SIGTERM and waits until the server has actually stopped listening. */
export async function stopApiServer(): Promise<void> {
  if (!existsSync(PID_FILE)) return;
  const pid = Number(readFileSync(PID_FILE, 'utf8'));
  rmSync(PID_FILE);
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    return; // Already gone.
  }
  await waitForHealth(false);
}

async function waitForHealth(up: boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const healthy = await fetch(`${API_URL}/health`).then(
      (res) => res.ok,
      () => false
    );
    if (healthy === up) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`API server did not ${up ? 'start' : 'stop'} within ${timeoutMs} ms`);
}
