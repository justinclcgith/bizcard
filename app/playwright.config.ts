import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  use: { ...devices['Pixel 7'], baseURL: 'http://localhost:4173/bizcard/' },
  webServer: {
    command: 'BASE_PATH=/bizcard/ npm run build && BASE_PATH=/bizcard/ npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/bizcard/',
    reuseExistingServer: true,
    timeout: 120_000
  }
});
