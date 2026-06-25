import { describe, expect, it } from 'vitest';
import { getPalette, palettes, presets } from './options';

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
});
