import { describe, expect, it } from 'vitest';
import { getPalette, palettes, presets } from './options';
import { createPreset } from './presets';

describe('visualization options', () => {
  it('keeps the persisted preset ids compatible while upgrading their rendering', () => {
    expect(presets.map((preset) => preset.id)).toEqual([
      'particle-field',
      'liquid-ribbons',
      'spectral-bloom',
      'waveform-orbit'
    ]);
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

  it('creates every persisted preset through the preset factory', () => {
    const palette = getPalette('aurora');

    for (const presetOption of presets) {
      const preset = createPreset(presetOption.id, palette);
      expect(preset.id).toBe(presetOption.id);
      expect(preset.name).toBeTruthy();
    }
  });
});
