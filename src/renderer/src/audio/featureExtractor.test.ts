import { describe, expect, it } from 'vitest';
import { FeatureExtractor, VISUAL_BAND_COUNT, createSilentAudioFeatures } from './featureExtractor';

function makeFrequencyData(length: number, activeRange: [number, number], value: number): Uint8Array {
  const data = new Uint8Array(length);
  for (let index = activeRange[0]; index <= activeRange[1]; index += 1) {
    data[index] = value;
  }
  return data;
}

function makeWaveform(length: number, amplitude: number): Uint8Array {
  const data = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    data[index] = 128 + Math.round(Math.sin(index / 8) * amplitude);
  }
  return data;
}

describe('FeatureExtractor', () => {
  it('returns silent features for empty buffers', () => {
    expect(createSilentAudioFeatures().isSilent).toBe(true);
  });

  it('detects silence from flat frequency and waveform buffers', () => {
    const extractor = new FeatureExtractor();
    const features = extractor.extract(new Uint8Array(1024), new Uint8Array(2048).fill(128), {
      sampleRate: 48_000,
      sensitivity: 1,
      smoothing: 0.8,
      silenceThreshold: 0.01
    });

    expect(features.isSilent).toBe(true);
    expect(features.rms).toBe(0);
    expect(features.bass).toBe(0);
  });

  it('marks low bins as bass-heavy', () => {
    const extractor = new FeatureExtractor();
    const features = extractor.extract(makeFrequencyData(1024, [1, 9], 240), makeWaveform(2048, 42), {
      sampleRate: 48_000,
      sensitivity: 1,
      smoothing: 0.8,
      silenceThreshold: 0.01
    });

    expect(features.bass).toBeGreaterThan(features.mid);
    expect(features.bass).toBeGreaterThan(features.treble);
    expect(features.isSilent).toBe(false);
  });

  it('marks high bins as treble-heavy', () => {
    const extractor = new FeatureExtractor();
    const features = extractor.extract(makeFrequencyData(1024, [720, 920], 220), makeWaveform(2048, 30), {
      sampleRate: 48_000,
      sensitivity: 1,
      smoothing: 0.8,
      silenceThreshold: 0.01
    });

    expect(features.treble).toBeGreaterThan(features.bass);
    expect(features.centroid).toBeGreaterThan(0.45);
  });

  it('emits a beat pulse when bass rises quickly', () => {
    const extractor = new FeatureExtractor();
    extractor.extract(makeFrequencyData(1024, [1, 9], 20), makeWaveform(2048, 12), {
      sampleRate: 48_000,
      sensitivity: 1,
      smoothing: 0.8,
      silenceThreshold: 0.01
    });

    const features = extractor.extract(makeFrequencyData(1024, [1, 9], 255), makeWaveform(2048, 70), {
      sampleRate: 48_000,
      sensitivity: 1,
      smoothing: 0.8,
      silenceThreshold: 0.01
    });

    expect(features.beatPulse).toBeGreaterThan(0.3);
    expect(features.bassPulse).toBeGreaterThan(0.3);
  });

  it('creates log-spaced visual bands with envelopes and peaks', () => {
    const extractor = new FeatureExtractor();
    const features = extractor.extract(makeFrequencyData(1024, [3, 360], 180), makeWaveform(2048, 38), {
      sampleRate: 48_000,
      sensitivity: 1,
      smoothing: 0.8,
      silenceThreshold: 0.01
    });

    expect(features.bands).toHaveLength(VISUAL_BAND_COUNT);
    expect(features.bandEnvelopes).toHaveLength(VISUAL_BAND_COUNT);
    expect(features.bandPeaks).toHaveLength(VISUAL_BAND_COUNT);
    expect(Math.max(...features.bands)).toBeGreaterThan(0);
    expect(Math.max(...features.bandPeaks)).toBeGreaterThanOrEqual(Math.max(...features.bandEnvelopes));
  });

  it('detects spectral flux and onset after a sudden energy rise', () => {
    const extractor = new FeatureExtractor();
    for (let index = 0; index < 4; index += 1) {
      extractor.extract(makeFrequencyData(1024, [1, 20], 18), makeWaveform(2048, 10), {
        sampleRate: 48_000,
        sensitivity: 1,
        smoothing: 0.8,
        silenceThreshold: 0.01
      });
    }

    const features = extractor.extract(makeFrequencyData(1024, [1, 420], 230), makeWaveform(2048, 76), {
      sampleRate: 48_000,
      sensitivity: 1,
      smoothing: 0.8,
      silenceThreshold: 0.01
    });

    expect(features.energy).toBeGreaterThan(0.1);
    expect(features.spectralFlux).toBeGreaterThan(0.1);
    expect(features.onsetPulse).toBeGreaterThan(0.3);
  });

  it('distinguishes flat noise-like spectra from tonal spectra', () => {
    const tonalExtractor = new FeatureExtractor();
    const noiseExtractor = new FeatureExtractor();
    const tonal = makeFrequencyData(1024, [82, 82], 255);
    const noise = makeFrequencyData(1024, [1, 920], 120);

    const tonalFeatures = tonalExtractor.extract(tonal, makeWaveform(2048, 36), {
      sampleRate: 48_000,
      sensitivity: 1,
      smoothing: 0.8,
      silenceThreshold: 0.01
    });
    const noiseFeatures = noiseExtractor.extract(noise, makeWaveform(2048, 36), {
      sampleRate: 48_000,
      sensitivity: 1,
      smoothing: 0.8,
      silenceThreshold: 0.01
    });

    expect(noiseFeatures.spectralFlatness).toBeGreaterThan(tonalFeatures.spectralFlatness);
  });

  it('reports higher rolloff and centroid for high-frequency material', () => {
    const lowExtractor = new FeatureExtractor();
    const highExtractor = new FeatureExtractor();
    const low = lowExtractor.extract(makeFrequencyData(1024, [1, 32], 220), makeWaveform(2048, 36), {
      sampleRate: 48_000,
      sensitivity: 1,
      smoothing: 0.8,
      silenceThreshold: 0.01
    });
    const high = highExtractor.extract(makeFrequencyData(1024, [640, 920], 220), makeWaveform(2048, 36), {
      sampleRate: 48_000,
      sensitivity: 1,
      smoothing: 0.8,
      silenceThreshold: 0.01
    });

    expect(high.spectralRolloff).toBeGreaterThan(low.spectralRolloff);
    expect(high.centroid).toBeGreaterThan(low.centroid);
  });

  it('decays band envelopes after energy drops', () => {
    const extractor = new FeatureExtractor();
    const loud = extractor.extract(makeFrequencyData(1024, [1, 360], 240), makeWaveform(2048, 72), {
      sampleRate: 48_000,
      sensitivity: 1,
      smoothing: 0.8,
      silenceThreshold: 0.01
    });
    const loudEnvelope = Math.max(...loud.bandEnvelopes);
    const quiet = extractor.extract(new Uint8Array(1024), new Uint8Array(2048).fill(128), {
      sampleRate: 48_000,
      sensitivity: 1,
      smoothing: 0.8,
      silenceThreshold: 0.01
    });

    expect(Math.max(...quiet.bandEnvelopes)).toBeLessThan(loudEnvelope);
    expect(Math.max(...quiet.bandEnvelopes)).toBeGreaterThan(0);
  });

  it('keeps adaptive normalization useful for quiet material', () => {
    const extractor = new FeatureExtractor();
    for (let frame = 0; frame < 20; frame += 1) {
      extractor.extract(makeFrequencyData(1024, [1, 360], 42), makeWaveform(2048, 14), {
        sampleRate: 48_000,
        sensitivity: 1,
        smoothing: 0.8,
        silenceThreshold: 0.01,
        timestampMs: frame * 100
      });
    }

    const quiet = extractor.extract(makeFrequencyData(1024, [1, 360], 36), makeWaveform(2048, 12), {
      sampleRate: 48_000,
      sensitivity: 1,
      smoothing: 0.8,
      silenceThreshold: 0.01,
      timestampMs: 2_200
    });

    expect(Math.max(...quiet.bands)).toBeGreaterThan(0.2);
    expect(Math.max(...quiet.bands)).toBeLessThanOrEqual(1);
  });

  it('uses time-based histories so pulse behavior is similar across update rates', () => {
    const fast = new FeatureExtractor();
    const slow = new FeatureExtractor();
    for (let time = 0; time <= 8_000; time += 1000 / 60) {
      fast.extract(makeFrequencyData(1024, [1, 32], 28), makeWaveform(2048, 12), {
        sampleRate: 48_000,
        sensitivity: 1,
        smoothing: 0.8,
        silenceThreshold: 0.01,
        timestampMs: time
      });
    }
    for (let time = 0; time <= 8_000; time += 1000 / 30) {
      slow.extract(makeFrequencyData(1024, [1, 32], 28), makeWaveform(2048, 12), {
        sampleRate: 48_000,
        sensitivity: 1,
        smoothing: 0.8,
        silenceThreshold: 0.01,
        timestampMs: time
      });
    }

    const fastSpike = fast.extract(makeFrequencyData(1024, [1, 420], 230), makeWaveform(2048, 76), {
      sampleRate: 48_000,
      sensitivity: 1,
      smoothing: 0.8,
      silenceThreshold: 0.01,
      timestampMs: 8_100
    });
    const slowSpike = slow.extract(makeFrequencyData(1024, [1, 420], 230), makeWaveform(2048, 76), {
      sampleRate: 48_000,
      sensitivity: 1,
      smoothing: 0.8,
      silenceThreshold: 0.01,
      timestampMs: 8_100
    });

    expect(Math.abs(fastSpike.onsetPulse - slowSpike.onsetPulse)).toBeLessThan(0.25);
  });

  it('emits transient, slow, novelty, onset-density, and loudness-trend streams', () => {
    const extractor = new FeatureExtractor();
    for (let frame = 0; frame < 8; frame += 1) {
      extractor.extract(makeFrequencyData(1024, [1, 32], 24), makeWaveform(2048, 12), {
        sampleRate: 48_000,
        sensitivity: 1,
        smoothing: 0.8,
        silenceThreshold: 0.01,
        timestampMs: frame * 120
      });
    }

    const spike = extractor.extract(makeFrequencyData(1024, [1, 700], 240), makeWaveform(2048, 80), {
      sampleRate: 48_000,
      sensitivity: 1,
      smoothing: 0.8,
      silenceThreshold: 0.01,
      timestampMs: 1_100
    });
    const later = extractor.extract(makeFrequencyData(1024, [1, 700], 220), makeWaveform(2048, 72), {
      sampleRate: 48_000,
      sensitivity: 1,
      smoothing: 0.8,
      silenceThreshold: 0.01,
      timestampMs: 2_600
    });

    expect(spike.bandTransients).toHaveLength(VISUAL_BAND_COUNT);
    expect(spike.slowBands).toHaveLength(VISUAL_BAND_COUNT);
    expect(Math.max(...spike.bandTransients)).toBeGreaterThan(0.1);
    expect(Math.max(...later.slowBands)).toBeGreaterThan(Math.max(...spike.slowBands));
    expect(spike.novelty).toBeGreaterThan(0.1);
    expect(spike.onsetDensity).toBeGreaterThan(0);
    expect(spike.loudnessTrend).toBeGreaterThan(0);
  });
});
