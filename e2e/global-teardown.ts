import { stopApiServer } from './api-server';

export default async function globalTeardown(): Promise<void> {
  await stopApiServer();
}
