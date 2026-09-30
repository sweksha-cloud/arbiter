import { fileURLToPath } from 'node:url';

// Tests run against @arbiter/shared's TypeScript source, so no build is needed first.
export const sharedSourceAlias = {
  '@arbiter/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url))
};
