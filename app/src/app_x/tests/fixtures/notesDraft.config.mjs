import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: fileURLToPath(new URL('../../../../', import.meta.url)),
  plugins: [{ name: 'notes-fixture-actions', enforce: 'pre', resolveId(source, importer) {
    if (source === '../data/actions' && importer?.endsWith('/forms/useLogEditor.ts'))
      return fileURLToPath(new URL('./notesDraft.actions.ts', import.meta.url));
  } }, react()],
  server: { host: '127.0.0.1', port: 5177, strictPort: true },
});
