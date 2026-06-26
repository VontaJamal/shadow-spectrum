import { inflateSync } from 'node:zlib';
import { expect, test, _electron as electron, type Page } from '@playwright/test';

test.setTimeout(60_000);

interface DecodedPng {
  data: Uint8Array;
  height: number;
  width: number;
}

interface LuminanceMetrics {
  average: number;
  darkPercent: number;
  saturatedVisiblePercent: number;
  visiblePercent: number;
  veryBrightPercent: number;
}

async function stageHasVisiblePixels(page: Page): Promise<boolean> {
  const metrics = measureCenterStage(await page.screenshot());
  return metrics.average > 2 || metrics.visiblePercent > 0.2 || metrics.saturatedVisiblePercent > 0.2;
}

function decodePng(buffer: Buffer): DecodedPng {
  const signature = buffer.subarray(0, 8);
  if (!signature.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('Screenshot is not a PNG');
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatChunks: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (bitDepth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`Unsupported PNG format: bitDepth=${bitDepth}, colorType=${colorType}, interlace=${interlace}`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idatChunks));
  const rgba = new Uint8Array(width * height * 4);
  let rawOffset = 0;
  let previous = new Uint8Array(stride);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset];
    rawOffset += 1;
    const current = new Uint8Array(stride);

    for (let x = 0; x < stride; x += 1) {
      const value = raw[rawOffset];
      rawOffset += 1;
      const left = x >= channels ? current[x - channels] : 0;
      const up = previous[x] ?? 0;
      const upperLeft = x >= channels ? previous[x - channels] : 0;
      current[x] = applyPngFilter(filter, value, left, up, upperLeft);
    }

    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      rgba[target] = current[source];
      rgba[target + 1] = current[source + 1];
      rgba[target + 2] = current[source + 2];
      rgba[target + 3] = colorType === 6 ? current[source + 3] : 255;
    }

    previous = current;
  }

  return { data: rgba, height, width };
}

function applyPngFilter(filter: number, value: number, left: number, up: number, upperLeft: number): number {
  switch (filter) {
    case 0:
      return value;
    case 1:
      return (value + left) & 0xff;
    case 2:
      return (value + up) & 0xff;
    case 3:
      return (value + Math.floor((left + up) / 2)) & 0xff;
    case 4:
      return (value + paethPredictor(left, up, upperLeft)) & 0xff;
    default:
      throw new Error(`Unsupported PNG filter: ${filter}`);
  }
}

function paethPredictor(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);

  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) {
    return left;
  }

  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function measureCenterStage(buffer: Buffer): LuminanceMetrics {
  const image = decodePng(buffer);
  const left = Math.floor(image.width * 0.08);
  const right = Math.floor(image.width * 0.92);
  const top = Math.floor(image.height * 0.08);
  const bottom = Math.floor(image.height * 0.78);
  let luminanceSum = 0;
  let darkPixels = 0;
  let saturatedVisiblePixels = 0;
  let visiblePixels = 0;
  let veryBrightPixels = 0;
  let totalPixels = 0;

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * image.width + x) * 4;
      const red = image.data[offset];
      const green = image.data[offset + 1];
      const blue = image.data[offset + 2];
      const luminance =
        red * 0.2126 + green * 0.7152 + blue * 0.0722;
      luminanceSum += luminance;
      totalPixels += 1;
      if (luminance <= 32) {
        darkPixels += 1;
      }
      if (luminance >= 48) {
        visiblePixels += 1;
      }
      if (luminance >= 32 && Math.max(red, green, blue) - Math.min(red, green, blue) >= 35) {
        saturatedVisiblePixels += 1;
      }
      if (luminance >= 220) {
        veryBrightPixels += 1;
      }
    }
  }

  return {
    average: luminanceSum / totalPixels,
    darkPercent: (darkPixels / totalPixels) * 100,
    saturatedVisiblePercent: (saturatedVisiblePixels / totalPixels) * 100,
    visiblePercent: (visiblePixels / totalPixels) * 100,
    veryBrightPercent: (veryBrightPixels / totalPixels) * 100
  };
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
    await page.getByRole('button', { name: /start capture/i }).click();
    await page.waitForTimeout(1_000);

    await expect.poll(() => stageHasVisiblePixels(page)).toBe(true);

    await page.getByLabel('Toggle fullscreen').click();
    await page.waitForTimeout(800);
    await page.getByLabel('Change visuals automatically').check();
    await expect(page.getByLabel('Change visuals automatically')).toBeChecked();
    for (const preset of ['vortex-eye', 'electric-fold', 'liquid-veil', 'plasma-bowl']) {
      await page.getByLabel('Preset').selectOption(preset);
      await expect
        .poll(() => stageHasVisiblePixels(page), {
          message: `${preset} should render visible canvas output`,
          timeout: 12_000
        })
        .toBe(true);
    }
    await expect(page.getByLabel('Audio visualizer canvas')).toBeVisible();
    expect(consoleErrors).toEqual([]);
  } finally {
    await app.close();
  }
});

test('keeps the demo visualizer moody instead of washing the stage white', async () => {
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
    await page.getByRole('button', { name: /start capture/i }).click();
    await page.getByLabel('Preset').selectOption('electric-fold');
    await page.getByLabel('Palette').selectOption('mono-gold');
    await page.waitForTimeout(4_500);

    const metrics = measureCenterStage(await page.screenshot());

    expect(metrics.average).toBeGreaterThanOrEqual(20);
    expect(metrics.average).toBeLessThanOrEqual(135);
    expect(metrics.darkPercent).toBeLessThanOrEqual(88);
    expect(metrics.veryBrightPercent).toBeLessThanOrEqual(8);
    expect(metrics.darkPercent).toBeGreaterThanOrEqual(8);
    expect(metrics.visiblePercent).toBeGreaterThanOrEqual(10);
    expect(metrics.saturatedVisiblePercent).toBeGreaterThanOrEqual(5);
  } finally {
    await app.close();
  }
});
