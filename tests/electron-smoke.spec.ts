import { expect, test, _electron as electron } from '@playwright/test';

test('launches the Electron app and renders a nonblank visualizer', async () => {
  const app = await electron.launch({
    args: ['.'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: 'test'
    }
  });

  try {
    const page = await app.firstWindow();
    await page.waitForSelector('canvas.visualizer-canvas');
    await expect
      .poll(() => page.evaluate(() => window.visualizerApi?.platform), {
        message: 'preload bridge should expose the visualizer API'
      })
      .toBe('darwin');
    await page.waitForTimeout(1_000);

    const hasPixels = await page.evaluate(() => {
      const canvas = document.querySelector('canvas.visualizer-canvas') as HTMLCanvasElement | null;
      if (!canvas) {
        return false;
      }

      const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
      if (!context) {
        return false;
      }

      const width = Math.max(1, canvas.width);
      const height = Math.max(1, canvas.height);
      const pixels = new Uint8Array(width * height * 4);
      context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels);
      return pixels.some((value) => value > 0);
    });

    expect(hasPixels).toBe(true);

    await page.getByLabel('Toggle fullscreen').click();
    await page.getByLabel('Preset').selectOption('spectral-bloom');
    await expect(page.getByLabel('Audio visualizer canvas')).toBeVisible();
  } finally {
    await app.close();
  }
});
