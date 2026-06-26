import { describe, expect, it } from 'vitest';
import { defaultPresetId, getPalette, normalizePresetId, palettes, presets } from './options';
import { createPreset } from './presets';

describe('visualization options', () => {
  it('uses the new researched preset quartet in order', () => {
    expect(presets.map((preset) => preset.id)).toEqual([
      'feedback-tunnel',
      'wireframe-cascade',
      'chromatic-flow',
      'signal-scope'
    ]);
    expect(presets.map((preset) => preset.label)).toEqual([
      'Feedback Tunnel',
      'Wireframe Cascade',
      'Chromatic Flow',
      'Signal Scope'
    ]);
  });

  it('normalizes stale persisted preset ids to the new default', () => {
    expect(defaultPresetId).toBe('feedback-tunnel');
    for (const stalePresetId of ['particle-field', 'liquid-ribbons', 'spectral-bloom', 'waveform-orbit']) {
      expect(normalizePresetId(stalePresetId)).toBe(defaultPresetId);
    }
    expect(normalizePresetId('chromatic-flow')).toBe('chromatic-flow');
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
