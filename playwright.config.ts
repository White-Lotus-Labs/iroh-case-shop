import { defineConfig } from '@playwright/test';
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000';
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    headless: true,
    launchOptions: {
      // GPU headless matches scripts/visual-shots.mjs; swiftshader stalls this scene.
      // macOS uses ANGLE Metal. Elsewhere Chromium picks its default GPU backend
      // (D3D11 on Windows); Metal there falls back to SwiftShader.
      channel: 'chromium',
      args: [
        ...(process.platform === 'darwin' ? ['--use-angle=metal'] : []),
        '--enable-gpu',
        '--ignore-gpu-blocklist',
        '--enable-webgl',
      ],
    },
  },
  webServer: {
    command: `npm run dev -- --port ${new URL(baseURL).port || '3000'}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120000,
  },
});
