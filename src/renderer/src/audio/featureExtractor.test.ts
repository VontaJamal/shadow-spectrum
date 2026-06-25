import { describe, expect, it } from 'vitest';
import { FeatureExtractor, createSilentAudioFeatures } from './featureExtractor';

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
  });
});

