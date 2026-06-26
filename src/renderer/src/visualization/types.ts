import type * as THREE from 'three';
import type { AudioFeatures } from '../audio/types';

export type PresetId = 'vortex-eye' | 'electric-fold' | 'liquid-veil' | 'plasma-bowl';
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

export interface PresetCreateOptions {
  seed: number;
}

export interface VisualDna {
  internalMode: number;
  coordinateSystem: number;
  symmetryCount: number;
  mirrorMix: number;
  flowDirection: number;
  flowSpeed: number;
  turbulence: number;
  domainWarpScale: number;
  domainWarpStrength: number;
  noiseOctaves: number;
  centerX: number;
  centerY: number;
  compositionX: number;
  compositionY: number;
  zoom: number;
  rotationDrift: number;
  feedbackRotation: number;
  feedbackScale: number;
  feedbackTranslateX: number;
  feedbackTranslateY: number;
  feedbackDecay: number;
  feedbackDisplacement: number;
  colorPhase: number;
  paletteInterpolation: number;
  brightnessDistribution: number;
  fieldDensity: number;
  topologyMix: number;
}

export interface VisualEvolutionFrame {
  seed: number;
  elapsedMs: number;
  flow: number;
  event: number;
  fastImpact: number;
  macroEvent: number;
  novelty: number;
  dna: VisualDna;
}

export interface VisualTransitionFrame {
  activePresetId: PresetId;
  outgoingPresetId: PresetId | null;
  progress: number;
  durationMs: number;
  feedbackFade: number;
}

export interface VisualFrameContext {
  features: AudioFeatures;
  spectrumTexture: THREE.Texture | null;
  evolution: VisualEvolutionFrame;
  transition: VisualTransitionFrame;
  palette: Palette;
  deltaMs: number;
  elapsedMs: number;
  opacity: number;
}

export interface VisualizerPreset {
  id: PresetId;
  name: string;
  init(scene: THREE.Scene): void;
  update(context: VisualFrameContext): void;
  resize(size: Size): void;
  setPalette(palette: Palette): void;
  dispose(): void;
}
