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
  rms: number;
  bass: number;
  mid: number;
  treble: number;
  centroid: number;
  beatPulse: number;
  frequencyBins: Float32Array;
  waveform: Float32Array;
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
