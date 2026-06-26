import { describe, expect, it } from 'vitest';
import { createSilentAudioFeatures } from '../audio/featureExtractor';
import {
  AUDIO_TEXTURE_HEIGHT,
  AUDIO_TEXTURE_HISTORY_ROWS,
  AUDIO_TEXTURE_ROWS,
  AUDIO_TEXTURE_WIDTH,
  AudioSpectrumTexture
} from './audioTexture';

describe('AudioSpectrumTexture', () => {
  it('packs current bands, envelopes, peaks, transients, slow bands, and history rows', () => {
    const texture = new AudioSpectrumTexture();
    const bands = Float32Array.from({ length: AUDIO_TEXTURE_WIDTH }, (_value, index) => index / AUDIO_TEXTURE_WIDTH);
    const features = {
      ...createSilentAudioFeatures(),
      bands,
      bandEnvelopes: bands.map((value) => value * 0.8) as Float32Array,
      bandPeaks: bands.map((value) => value * 1.1) as Float32Array,
      bandTransients: bands.map((value) => value * 0.5) as Float32Array,
      slowBands: bands.map((value) => value * 0.3) as Float32Array,
      novelty: 0.4,
      onsetDensity: 0.3,
      loudnessTrend: 0.2
    };

    texture.update(features);

    expect(texture.texture.image.width).toBe(AUDIO_TEXTURE_WIDTH);
    expect(texture.texture.image.height).toBe(AUDIO_TEXTURE_HEIGHT);
    expect(texture.data[(AUDIO_TEXTURE_ROWS.current * AUDIO_TEXTURE_WIDTH + 12) * 4]).toBeCloseTo(12 / AUDIO_TEXTURE_WIDTH);
    expect(texture.data[(AUDIO_TEXTURE_ROWS.current * AUDIO_TEXTURE_WIDTH + 12) * 4 + 3]).toBeCloseTo(0.25);
    expect(texture.data[(AUDIO_TEXTURE_ROWS.slow * AUDIO_TEXTURE_WIDTH + 3) * 4 + 3]).toBeCloseTo(0.4);
    expect(texture.data[((AUDIO_TEXTURE_ROWS.historyStart + AUDIO_TEXTURE_HISTORY_ROWS - 1) * AUDIO_TEXTURE_WIDTH + 12) * 4]).toBe(0);

    texture.dispose();
  });
});
