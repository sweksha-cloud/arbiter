import { defineConfig } from 'vitest/config';

import { sharedSourceAlias } from './vitest.shared-alias.js';

export default defineConfig({
  resolve: { alias: sharedSourceAlias },
  test: {
    include: ['src/**/*.integration.test.ts'],
    globalSetup: ['./test/integration-setup.ts']
  }
});
