import { expect, test, _electron as electron, type Page } from '@playwright/test';

async function canvasHasPixels(page: Page): Promise<boolean> {
  return page.evaluate(() => {
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
}

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
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text());
      }
    });

    await page.waitForSelector('canvas.visualizer-canvas');
    await expect
      .poll(() => page.evaluate(() => window.visualizerApi?.platform), {
        message: 'preload bridge should expose the visualizer API'
      })
      .toBe('darwin');
    await page.waitForTimeout(1_000);

    await expect.poll(() => canvasHasPixels(page)).toBe(true);

    await page.getByLabel('Toggle fullscreen').click();
    await page.getByLabel('Auto-cycle').check();
    await expect(page.getByLabel('Auto-cycle')).toBeChecked();
    for (const preset of ['feedback-tunnel', 'wireframe-cascade', 'chromatic-flow', 'signal-scope']) {
      await page.getByLabel('Preset').selectOption(preset);
      await expect.poll(() => canvasHasPixels(page), { message: `${preset} should render nonblank canvas output` }).toBe(true);
    }
    await expect(page.getByLabel('Audio visualizer canvas')).toBeVisible();
    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
  }
});
