import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSilentAudioFeatures } from '../audio/featureExtractor';
import { defaultPresetId, getPalette, normalizePresetId, palettes, presets } from './options';
import { createPreset } from './presets';
import { createRandomDna } from './evolution';
import { SeededPrng } from './prng';
import type { Palette, VisualFrameContext } from './types';

describe('visualization options', () => {
  it('uses the new researched preset quartet in order', () => {
    expect(presets.map((preset) => preset.id)).toEqual([
      'vortex-eye',
      'electric-fold',
      'liquid-veil',
      'plasma-bowl'
    ]);
    expect(presets.map((preset) => preset.label)).toEqual([
      'Vortex Eye',
      'Electric Fold',
      'Liquid Veil',
      'Plasma Bowl'
    ]);
  });

  it('normalizes stale persisted preset ids to the new default', () => {
    expect(defaultPresetId).toBe('vortex-eye');
    for (const stalePresetId of [
      'particle-field',
      'liquid-ribbons',
      'spectral-bloom',
      'waveform-orbit',
      'feedback-tunnel',
      'wireframe-cascade',
      'chromatic-flow',
      'signal-scope'
    ]) {
      expect(normalizePresetId(stalePresetId)).toBe(defaultPresetId);
    }
    expect(normalizePresetId('neon-analyzer')).toBe('liquid-veil');
    expect(normalizePresetId('liquid-veil')).toBe('liquid-veil');
  });

  it('provides cinematic palette metadata for every palette option', () => {
    for (const paletteOption of palettes) {
      const palette = getPalette(paletteOption.id);

      expect(palette.background).toMatch(/^#/);
      expect(palette.fog).toMatch(/^#/);
      expect(palette.glow).toMatch(/^#/);
      expect(palette.primary).toMatch(/^#/);
      expect(palette.secondary).toMatch(/^#/);
    }
  });

  it('creates every preset through the preset factory', () => {
    const palette = getPalette('aurora');

    for (const presetOption of presets) {
      const preset = createPreset(presetOption.id, palette);
      expect(preset.id).toBe(presetOption.id);
      expect(preset.name).toBeTruthy();
    }
  });

  it('updates and disposes every preset without throwing', () => {
    const palette = getPalette('aurora');
    const features = createSilentAudioFeatures();
    const bands = new Float32Array(32).fill(0.24);
    const waveform = new Float32Array(128).map((_value, index) => Math.sin(index / 6) * 0.4);
    const activeFeatures = {
      ...features,
      rms: 0.32,
      bass: 0.42,
      mid: 0.36,
      treble: 0.28,
      centroid: 0.58,
      beatPulse: 0.52,
      energy: 0.5,
      spectralFlux: 0.46,
      spectralFlatness: 0.34,
      spectralRolloff: 0.62,
      dynamicRange: 0.48,
      onsetPulse: 0.7,
      bassPulse: 0.64,
      midPulse: 0.42,
      treblePulse: 0.32,
      waveform,
      bands,
      bandEnvelopes: bands,
      bandPeaks: bands,
      isSilent: false
    };

    for (const presetOption of presets) {
      const scene = new THREE.Scene();
      const preset = createPreset(presetOption.id, palette);
      preset.init(scene);
      preset.resize({ width: 1440, height: 900 });
      preset.update(createFrameContext(activeFeatures, palette, 16));
      preset.update(createFrameContext({ ...activeFeatures, onsetPulse: 0.1 }, palette, 64));
      preset.update(createFrameContext({ ...activeFeatures, onsetPulse: 0.8, spectralFlux: 0.7 }, palette, 240));
      expectFiniteUniforms(scene);
      preset.dispose();

      expect(scene.children).toHaveLength(0);
    }
  });
});

function createFrameContext(features: ReturnType<typeof createSilentAudioFeatures>, palette: Palette, deltaMs: number): VisualFrameContext {
  return {
    features,
    spectrumTexture: null,
    evolution: {
      seed: 0.25,
      elapsedMs: deltaMs,
      flow: deltaMs / 1000,
      event: features.onsetPulse,
      fastImpact: features.onsetPulse,
      macroEvent: 0,
      novelty: features.novelty,
      dna: createRandomDna(new SeededPrng(12))
    },
    transition: {
      activePresetId: 'vortex-eye',
      outgoingPresetId: null,
      progress: 1,
      durationMs: 1,
      feedbackFade: 0
    },
    palette,
    deltaMs,
    elapsedMs: deltaMs,
    opacity: 1
  };
}

function expectFiniteUniforms(scene: THREE.Scene): void {
  scene.traverse((object) => {
    const renderable = object as THREE.Mesh | THREE.Points | THREE.Line;
    const materials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
    for (const material of materials) {
      const shader = material as THREE.ShaderMaterial | undefined;
      if (!shader?.uniforms) {
        continue;
      }

      for (const uniform of Object.values(shader.uniforms)) {
        const value = uniform.value as unknown;
        if (typeof value === 'number') {
          expect(Number.isFinite(value)).toBe(true);
        } else if (value instanceof THREE.Vector2) {
          expect(Number.isFinite(value.x)).toBe(true);
          expect(Number.isFinite(value.y)).toBe(true);
        } else if (value instanceof THREE.Color) {
          expect(Number.isFinite(value.r)).toBe(true);
          expect(Number.isFinite(value.g)).toBe(true);
          expect(Number.isFinite(value.b)).toBe(true);
        }
      }
    }
  });
}
