import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createSilentAudioFeatures } from '../audio/featureExtractor';
import { defaultPresetId, getPalette, normalizePresetId, palettes, presets } from './options';
import { createPreset } from './presets';

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
      preset.update(activeFeatures, 16);
      preset.update({ ...activeFeatures, onsetPulse: 0.1 }, 64);
      preset.update({ ...activeFeatures, onsetPulse: 0.8, spectralFlux: 0.7 }, 240);
      preset.dispose();

      expect(scene.children).toHaveLength(0);
    }
  });
});
