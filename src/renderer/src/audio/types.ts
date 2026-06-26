export type AudioSourceKind = 'desktop-loopback' | 'microphone' | 'synthetic-demo';

export type AudioSourceStatus =
  | 'idle'
  | 'requesting'
  | 'active'
  | 'silent'
  | 'unsupported'
  | 'permission-denied'
  | 'error'
  | 'stopped';

export type AudioSourceEvent =
  | 'request'
  | 'stream-started'
  | 'silence-detected'
  | 'audio-detected'
  | 'unsupported'
  | 'permission-denied'
  | 'error'
  | 'stop';

export interface AnalysisOptions {
  sensitivity: number;
  smoothing: number;
  silenceThreshold: number;
}

export interface AudioFeatures {
  timestampMs: number;
  rms: number;
  bass: number;
  mid: number;
  treble: number;
  centroid: number;
  beatPulse: number;
  energy: number;
  spectralFlux: number;
  spectralFlatness: number;
  spectralRolloff: number;
  dynamicRange: number;
  onsetPulse: number;
  bassPulse: number;
  midPulse: number;
  treblePulse: number;
  frequencyBins: Float32Array;
  waveform: Float32Array;
  bands: Float32Array;
  bandEnvelopes: Float32Array;
  bandPeaks: Float32Array;
  bandTransients: Float32Array;
  slowBands: Float32Array;
  novelty: number;
  onsetDensity: number;
  loudnessTrend: number;
  isSilent: boolean;
}

export interface AudioSource {
  id: AudioSourceKind;
  label: string;
  kind: AudioSourceKind;
  status: AudioSourceStatus;
  message: string;
  start(): Promise<MediaStream>;
  stop(): void;
  getStream(): MediaStream | undefined;
}
