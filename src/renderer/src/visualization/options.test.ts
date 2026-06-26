import { describe, expect, it } from 'vitest';
import { defaultPresetId, getPalette, normalizePresetId, palettes, presets } from './options';
import { createPreset } from './presets';

describe('visualization options', () => {
  it('uses the new researched preset quartet in order', () => {
    expect(presets.map((preset) => preset.id)).toEqual([
      'vortex-eye',
      'electric-fold',
      'neon-analyzer',
      'plasma-bowl'
    ]);
    expect(presets.map((preset) => preset.label)).toEqual([
      'Vortex Eye',
      'Electric Fold',
      'Neon Analyzer',
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
    expect(normalizePresetId('neon-analyzer')).toBe('neon-analyzer');
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
});
