import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  testDir: '.', testMatch: 'notesDraft.spec.mjs', workers: 1,
  use: { baseURL: 'http://127.0.0.1:5177', headless: true },
  outputDir: '/Users/danielcepeda/repos/_codex_output/concertboxd/notes-draft-results',
  webServer: {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
    command: 'npx vite --config src/app_x/tests/fixtures/notesDraft.config.mjs',
    url: 'http://127.0.0.1:5177/src/app_x/tests/fixtures/notesDraft.html',
    reuseExistingServer: false,
  },
});
