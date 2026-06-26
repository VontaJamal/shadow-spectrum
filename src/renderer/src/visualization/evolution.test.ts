import { describe, expect, it } from 'vitest';
import { createSilentAudioFeatures } from '../audio/featureExtractor';
import type { AudioFeatures } from '../audio/types';
import { VisualEvolutionController, exponentialAlpha } from './evolution';

function makeFeatures(patch: Partial<AudioFeatures> = {}): AudioFeatures {
  const bands = new Float32Array(24).fill(0.28);
  return {
    ...createSilentAudioFeatures(),
    timestampMs: patch.timestampMs ?? 0,
    rms: 0.24,
    bass: 0.32,
    mid: 0.28,
    treble: 0.22,
    centroid: 0.48,
    beatPulse: 0.18,
    energy: 0.34,
    spectralFlux: 0.22,
    spectralFlatness: 0.24,
    spectralRolloff: 0.52,
    dynamicRange: 0.2,
    onsetPulse: 0.14,
    bassPulse: 0.12,
    midPulse: 0.1,
    treblePulse: 0.08,
    bands,
    bandEnvelopes: bands,
    bandPeaks: bands,
    bandTransients: new Float32Array(24).fill(0.06),
    slowBands: bands,
    novelty: 0.18,
    onsetDensity: 0.12,
    loudnessTrend: 0.08,
    isSilent: false,
    ...patch
  };
}

describe('VisualEvolutionController', () => {
  it('replays the same trajectory when the seed is pinned', () => {
    const first = new VisualEvolutionController({ seed: 42, presetId: 'vortex-eye' });
    const second = new VisualEvolutionController({ seed: 42, presetId: 'vortex-eye' });

    for (let frame = 0; frame < 240; frame += 1) {
      const features = makeFeatures({
        timestampMs: frame * 100,
        onsetPulse: frame % 37 === 0 ? 0.72 : 0.08,
        novelty: frame % 89 === 0 ? 0.7 : 0.12
      });
      expect(first.update(features, 100).dna).toEqual(second.update(features, 100).dna);
    }
  });

  it('produces different trajectories for different session seeds', () => {
    const first = new VisualEvolutionController({ seed: 101, presetId: 'liquid-veil' });
    const second = new VisualEvolutionController({ seed: 202, presetId: 'liquid-veil' });

    for (let frame = 0; frame < 160; frame += 1) {
      const features = makeFeatures({ timestampMs: frame * 250, novelty: frame % 23 === 0 ? 0.58 : 0.16 });
      first.update(features, 250);
      second.update(features, 250);
    }

    expect(first.macroVector()).not.toEqual(second.macroVector());
  });

  it('keeps mutation cooldowns after a novelty event', () => {
    const controller = new VisualEvolutionController({ seed: 99, presetId: 'electric-fold' });
    const eventFeatures = makeFeatures({ onsetPulse: 0.78, novelty: 0.5, onsetDensity: 0.22 });

    controller.update(eventFeatures, 100);
    const afterEvent = controller.debugState;
    controller.update(eventFeatures, 100);
    const afterCooldownTick = controller.debugState;

    expect(afterEvent.mediumCooldownMs).toBeGreaterThan(0);
    expect(afterCooldownTick.mediumCooldownMs).toBeGreaterThan(0);
    expect(afterCooldownTick.nextMediumMs).toBe(afterEvent.nextMediumMs);
  });

  it('uses frame-rate independent exponential interpolation math', () => {
    const oneSecondAlpha = exponentialAlpha(1000, 4600);
    const tenFrameAlpha = 1 - Math.pow(1 - exponentialAlpha(100, 4600), 10);

    expect(tenFrameAlpha).toBeCloseTo(oneSecondAlpha, 6);
  });

  it('does not fall into a short exact macro cycle over ten minutes', () => {
    const controller = new VisualEvolutionController({ seed: 777, presetId: 'plasma-bowl' });
    const vectors: string[] = [];

    for (let frame = 0; frame < 600; frame += 1) {
      const features = makeFeatures({
        timestampMs: frame * 1000,
        onsetPulse: frame % 17 === 0 ? 0.66 : 0.08,
        bassPulse: frame % 29 === 0 ? 0.52 : 0.06,
        treblePulse: frame % 11 === 0 ? 0.4 : 0.05,
        spectralFlux: 0.12 + (frame % 31) / 120,
        novelty: frame % 47 === 0 ? 0.72 : 0.1 + (frame % 13) / 90,
        onsetDensity: frame % 53 < 8 ? 0.44 : 0.12
      });
      controller.update(features, 1000);
      if (frame % 5 === 0) {
        vectors.push(controller.macroVector().join(','));
      }
    }

    expect(new Set(vectors).size).toBeGreaterThan(60);
    expect(vectors.slice(0, 12)).not.toEqual(vectors.slice(12, 24));
  });
});
