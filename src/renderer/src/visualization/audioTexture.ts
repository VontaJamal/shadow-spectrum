import * as THREE from 'three';
import { VISUAL_BAND_COUNT } from '../audio/featureExtractor';
import type { AudioFeatures } from '../audio/types';

export const AUDIO_TEXTURE_WIDTH = VISUAL_BAND_COUNT;
export const AUDIO_TEXTURE_HEIGHT = 16;
export const AUDIO_TEXTURE_HISTORY_ROWS = AUDIO_TEXTURE_HEIGHT - 2;

export const AUDIO_TEXTURE_ROWS = {
  current: 0,
  slow: 1,
  historyStart: 2
} as const;

export class AudioSpectrumTexture {
  readonly data = new Float32Array(AUDIO_TEXTURE_WIDTH * AUDIO_TEXTURE_HEIGHT * 4);
  readonly texture: THREE.DataTexture;
  private historyCursor = 0;

  constructor() {
    this.texture = new THREE.DataTexture(
      this.data,
      AUDIO_TEXTURE_WIDTH,
      AUDIO_TEXTURE_HEIGHT,
      THREE.RGBAFormat,
      THREE.FloatType
    );
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
  }

  update(features: AudioFeatures): void {
    const historyRow = AUDIO_TEXTURE_ROWS.historyStart + this.historyCursor;
    for (let band = 0; band < AUDIO_TEXTURE_WIDTH; band += 1) {
      const current = finiteBand(features.bands, band);
      const envelope = finiteBand(features.bandEnvelopes, band);
      const peak = finiteBand(features.bandPeaks, band);
      const transient = finiteBand(features.bandTransients, band);
      const slow = finiteBand(features.slowBands, band);

      this.writeTexel(AUDIO_TEXTURE_ROWS.current, band, current, envelope, peak, transient);
      this.writeTexel(AUDIO_TEXTURE_ROWS.slow, band, slow, features.loudnessTrend, features.onsetDensity, features.novelty);
      this.writeTexel(historyRow, band, current, envelope, peak, slow);
    }

    this.historyCursor = (this.historyCursor + 1) % AUDIO_TEXTURE_HISTORY_ROWS;
    this.texture.needsUpdate = true;
  }

  reset(): void {
    this.data.fill(0);
    this.historyCursor = 0;
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }

  private writeTexel(row: number, column: number, r: number, g: number, b: number, a: number): void {
    const offset = (row * AUDIO_TEXTURE_WIDTH + column) * 4;
    this.data[offset] = clampFinite(r);
    this.data[offset + 1] = clampFinite(g);
    this.data[offset + 2] = clampFinite(b);
    this.data[offset + 3] = clampFinite(a);
  }
}

function finiteBand(values: Float32Array, index: number): number {
  return clampFinite(values[index] ?? 0);
}

function clampFinite(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}
