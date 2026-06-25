import type { Palette, PaletteId, PresetId } from './types';

export const presets: Array<{ id: PresetId; label: string }> = [
  { id: 'particle-field', label: 'Particles' },
  { id: 'liquid-ribbons', label: 'Ribbons' },
  { id: 'spectral-bloom', label: 'Bloom' },
  { id: 'waveform-orbit', label: 'Orbit' }
];

export const palettes: Array<{ id: PaletteId; label: string }> = [
  { id: 'aurora', label: 'Aurora' },
  { id: 'ember', label: 'Ember' },
  { id: 'mono-gold', label: 'Gold' }
];

const paletteMap: Record<PaletteId, Palette> = {
  aurora: {
    background: '#020407',
    fog: '#07131b',
    glow: '#b9fff2',
    primary: '#7df9c6',
    secondary: '#38bdf8',
    hot: '#ff6b8a',
    soft: '#fffaf0'
  },
  ember: {
    background: '#050304',
    fog: '#1a0808',
    glow: '#ffe2a8',
    primary: '#ffb84d',
    secondary: '#ff6a3d',
    hot: '#7df9c6',
    soft: '#fff7ea'
  },
  'mono-gold': {
    background: '#030303',
    fog: '#14120a',
    glow: '#fff0b8',
    primary: '#ffd166',
    secondary: '#f7f0d5',
    hot: '#7df9c6',
    soft: '#fffaf0'
  }
};

export function getPalette(id: PaletteId): Palette {
  return paletteMap[id] ?? paletteMap.aurora;
}
