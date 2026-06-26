import type { AudioFeatures } from '../audio/types';
import type { PresetId } from './types';
import { presets } from './options';
import { SeededPrng, createSessionSeed, deriveSeed } from './prng';

export interface AutoCycleDecision {
  presetId: PresetId;
  reason: 'musical-boundary' | 'fallback';
}

export class VisualAutoCycleController {
  private readonly random: SeededPrng;
  private cycleStartedAt = 0;
  private lastPresetId: PresetId | null = null;
  private minimumIntervalMs = 35_000;
  private fallbackIntervalMs = 76_000;

  constructor(seed = createSessionSeed()) {
    this.random = new SeededPrng(deriveSeed(seed, 'auto-cycle'));
  }

  reset(nowMs: number, presetId: PresetId): void {
    this.cycleStartedAt = nowMs;
    this.lastPresetId = presetId;
    this.minimumIntervalMs = this.random.range(32_000, 48_000);
    this.fallbackIntervalMs = this.minimumIntervalMs + this.random.range(24_000, 44_000);
  }

  evaluate(nowMs: number, currentPresetId: PresetId, features: AudioFeatures): AutoCycleDecision | null {
    if (this.lastPresetId !== currentPresetId) {
      this.reset(nowMs, currentPresetId);
      return null;
    }

    const elapsed = nowMs - this.cycleStartedAt;
    const boundary =
      features.novelty > 0.48 ||
      features.onsetDensity > 0.42 ||
      (features.spectralFlux > 0.42 && features.dynamicRange > 0.16) ||
      (features.loudnessTrend > 0.48 && features.onsetPulse > 0.22);
    const reason = elapsed >= this.fallbackIntervalMs ? 'fallback' : boundary && elapsed >= this.minimumIntervalMs ? 'musical-boundary' : null;
    if (!reason) {
      return null;
    }

    const presetId = this.choosePreset(currentPresetId, features);
    this.reset(nowMs, presetId);
    return { presetId, reason };
  }

  private choosePreset(currentPresetId: PresetId, features: AudioFeatures): PresetId {
    const candidates = presets.filter((preset) => preset.id !== currentPresetId);
    const weights = candidates.map((preset) => {
      const spectralBias =
        preset.id === 'vortex-eye'
          ? features.bass + features.spectralRolloff * 0.2
          : preset.id === 'electric-fold'
            ? features.treble + features.spectralFlux * 0.3
            : preset.id === 'liquid-veil'
              ? features.mid + features.spectralFlatness * 0.2
              : features.dynamicRange + features.onsetDensity * 0.4;
      return 0.6 + spectralBias + this.random.next() * 0.45;
    });
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let needle = this.random.range(0, total);
    for (let index = 0; index < candidates.length; index += 1) {
      needle -= weights[index];
      if (needle <= 0) {
        return candidates[index].id;
      }
    }
    return candidates[candidates.length - 1].id;
  }
}
