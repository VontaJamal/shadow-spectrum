import type * as THREE from 'three';
import type { AudioFeatures } from '../audio/types';

export type PresetId = 'feedback-tunnel' | 'wireframe-cascade' | 'chromatic-flow' | 'signal-scope';
export type PaletteId = 'aurora' | 'ember' | 'mono-gold';

export interface Palette {
  background: string;
  fog: string;
  glow: string;
  primary: string;
  secondary: string;
  hot: string;
  soft: string;
}

export interface Size {
  width: number;
  height: number;
}

export interface VisualizerPreset {
  id: PresetId;
  name: string;
  init(scene: THREE.Scene): void;
  update(features: AudioFeatures, deltaMs: number): void;
  resize(size: Size): void;
  dispose(): void;
}
