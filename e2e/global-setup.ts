import { startApiServer, stopApiServer } from './api-server';

export default async function globalSetup(): Promise<void> {
  await stopApiServer(); // Left over from an interrupted run.
  await startApiServer();
}
