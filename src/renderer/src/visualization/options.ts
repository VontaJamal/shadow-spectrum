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
    background: '#05070a',
    primary: '#7df9c6',
    secondary: '#2bd9ff',
    hot: '#ff6b8a',
    soft: '#fffaf0'
  },
  ember: {
    background: '#070607',
    primary: '#ffaf45',
    secondary: '#f85f73',
    hot: '#7df9c6',
    soft: '#fff7ea'
  },
  'mono-gold': {
    background: '#070707',
    primary: '#ffd166',
    secondary: '#f7f0d5',
    hot: '#7df9c6',
    soft: '#fffaf0'
  }
};

export function getPalette(id: PaletteId): Palette {
  return paletteMap[id] ?? paletteMap.aurora;
}

