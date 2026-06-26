import { describe, expect, it } from 'vitest';
import { deserializeNativeFeatures } from './AudioEngine';
import { VISUAL_BAND_COUNT } from './featureExtractor';

describe('deserializeNativeFeatures', () => {
  it('hydrates stale native feature payloads with defaults for new visual fields', () => {
    const features = deserializeNativeFeatures(
      {
        type: 'features',
        features: {
          rms: 0.1,
          bass: 0.2,
          mid: 0.15,
          treble: 0.05,
          centroid: 0.4,
          beatPulse: 0.3,
          frequencyBins: Array.from({ length: 96 }, (_entry, index) => (index < 24 ? 0.2 : 0.04)),
          waveform: Array.from({ length: 128 }, (_entry, index) => Math.sin(index / 8) * 0.1),
          isSilent: false
        }
      },
      1
    );

    expect(features).not.toBeNull();
    expect(features?.bands).toHaveLength(VISUAL_BAND_COUNT);
    expect(features?.bandEnvelopes).toHaveLength(VISUAL_BAND_COUNT);
    expect(features?.bandPeaks).toHaveLength(VISUAL_BAND_COUNT);
    expect(features?.energy).toBeGreaterThan(0);
    expect(features?.onsetPulse).toBeCloseTo(0.3);
    expect(features?.spectralRolloff).toBeCloseTo(0.4);
  });

  it('hydrates the full native feature contract', () => {
    const bands = Array.from({ length: VISUAL_BAND_COUNT }, (_entry, index) => index / VISUAL_BAND_COUNT);
    const features = deserializeNativeFeatures(
      {
        type: 'features',
        features: {
          rms: 0.1,
          bass: 0.2,
          mid: 0.15,
          treble: 0.05,
          centroid: 0.4,
          beatPulse: 0.3,
          energy: 0.24,
          spectralFlux: 0.18,
          spectralFlatness: 0.42,
          spectralRolloff: 0.64,
          dynamicRange: 0.31,
          onsetPulse: 0.52,
          bassPulse: 0.48,
          midPulse: 0.22,
          treblePulse: 0.12,
          frequencyBins: Array.from({ length: 96 }, () => 0.2),
          waveform: Array.from({ length: 128 }, () => 0.1),
          bands,
          bandEnvelopes: bands.map((value) => value * 0.8),
          bandPeaks: bands.map((value) => value * 1.1),
          isSilent: false
        }
      },
      1
    );

    expect(features?.energy).toBeCloseTo(0.24);
    expect(features?.spectralFlux).toBeCloseTo(0.18);
    expect(features?.spectralFlatness).toBeCloseTo(0.42);
    expect(features?.spectralRolloff).toBeCloseTo(0.64);
    expect(features?.dynamicRange).toBeCloseTo(0.31);
    expect(features?.onsetPulse).toBeCloseTo(0.52);
    expect(features?.bassPulse).toBeCloseTo(0.48);
    expect(features?.midPulse).toBeCloseTo(0.22);
    expect(features?.treblePulse).toBeCloseTo(0.12);
    expect(features?.bandPeaks[VISUAL_BAND_COUNT - 1]).toBeGreaterThan(features?.bandEnvelopes[VISUAL_BAND_COUNT - 1] ?? 0);
  });
});
