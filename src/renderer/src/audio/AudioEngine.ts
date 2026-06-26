import { FeatureExtractor, VISUAL_BAND_COUNT } from './featureExtractor';
import { UnsupportedCaptureError, createAudioSource, transitionSourceStatus } from './sources';
import type {
  AnalysisOptions,
  AudioFeatures,
  AudioSource,
  AudioSourceKind,
  AudioSourceStatus
} from './types';

interface AudioEngineOptions {
  onFeatures: (features: AudioFeatures) => void;
  onStatus: (status: AudioSourceStatus, message: string) => void;
}

export class AudioEngine {
  private analyser?: AnalyserNode;
  private audioContext?: AudioContext;
  private currentSource?: AudioSource;
  private extractor = new FeatureExtractor();
  private frequencyData = new Uint8Array(0);
  private waveformData = new Uint8Array(0);
  private nativeFeatureCleanup?: () => void;
  private nativeStatusCleanup?: () => void;
  private rafId = 0;
  private silentFrames = 0;
  private sourceNode?: MediaStreamAudioSourceNode;
  private status: AudioSourceStatus = 'idle';
  private options: AnalysisOptions = {
    sensitivity: 1.1,
    smoothing: 0.78,
    silenceThreshold: 0.012
  };

  constructor(private readonly callbacks: AudioEngineOptions) {}

  updateAnalysisOptions(options: Partial<AnalysisOptions>): void {
    this.options = { ...this.options, ...options };

    if (this.analyser && typeof options.smoothing === 'number') {
      this.analyser.smoothingTimeConstant = options.smoothing;
    }
  }

  async start(kind: AudioSourceKind): Promise<void> {
    this.stop();
    this.setStatus('requesting', 'Waiting for audio permission');

    if (kind === 'desktop-loopback' && window.visualizerApi?.platform === 'darwin') {
      await this.startNativeSystemAudio();
      return;
    }

    const source = createAudioSource(kind);
    this.currentSource = source;

    try {
      const stream = await source.start();
      this.status = transitionSourceStatus(source.status, 'stream-started');
      this.setStatus(this.status, `${source.label} active`);
      await this.connectStream(stream);
      this.tick();
    } catch (error) {
      const status =
        error instanceof UnsupportedCaptureError
          ? 'unsupported'
          : error instanceof DOMException && error.name === 'NotAllowedError'
            ? 'permission-denied'
            : 'error';
      this.setStatus(status, source.message);
      this.stopMediaOnly();
      throw error;
    }
  }

  stop(): void {
    window.cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.stopNativeSystemAudio();
    this.stopMediaOnly();
    this.extractor.reset();
    this.silentFrames = 0;
    this.setStatus('stopped', 'Capture stopped');
  }

  private async connectStream(stream: MediaStream): Promise<void> {
    this.audioContext = new AudioContext();
    await this.audioContext.resume();

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.minDecibels = -90;
    this.analyser.maxDecibels = -8;
    this.analyser.smoothingTimeConstant = this.options.smoothing;

    this.sourceNode = this.audioContext.createMediaStreamSource(stream);
    this.sourceNode.connect(this.analyser);
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.waveformData = new Uint8Array(this.analyser.fftSize);
  }

  private async startNativeSystemAudio(): Promise<void> {
    const api = window.visualizerApi;
    if (!api?.startSystemAudio || !api.onSystemAudioFeatures || !api.onSystemAudioStatus) {
      this.setStatus('unsupported', 'Native macOS system audio capture is not available in this app shell');
      throw new Error('Native macOS system audio capture is unavailable');
    }

    this.nativeFeatureCleanup = api.onSystemAudioFeatures((payload) => {
      const features = deserializeNativeFeatures(payload, this.options.sensitivity);
      if (!features) {
        return;
      }

      this.callbacks.onFeatures(features);

      if (this.status === 'requesting' || this.status === 'silent') {
        this.setStatus(features.isSilent ? 'silent' : 'active', features.isSilent ? 'System audio is connected but silent' : 'System audio active');
      }
    });

    this.nativeStatusCleanup = api.onSystemAudioStatus((payload) => {
      const status = deserializeNativeStatus(payload);
      if (!status) {
        return;
      }

      this.setStatus(status.status, status.message);
    });

    const result = await api.startSystemAudio();
    if (!result.ok) {
      this.stopNativeSystemAudio();
      this.setStatus('error', result.message);
      throw new Error(result.message);
    }
  }

  private tick = (): void => {
    if (!this.analyser || !this.audioContext) {
      return;
    }

    this.analyser.getByteFrequencyData(this.frequencyData);
    this.analyser.getByteTimeDomainData(this.waveformData);

    const features = this.extractor.extract(this.frequencyData, this.waveformData, {
      ...this.options,
      sampleRate: this.audioContext.sampleRate,
      timestampMs: performance.now()
    });

    if (features.isSilent) {
      this.silentFrames += 1;
    } else {
      this.silentFrames = 0;
      if (this.status === 'silent') {
        this.setStatus('active', `${this.currentSource?.label ?? 'Audio'} active`);
      }
    }

    if (this.silentFrames > 120 && this.status !== 'silent') {
      this.setStatus('silent', 'Audio stream is connected but currently silent');
    }

    this.callbacks.onFeatures(features);
    this.rafId = window.requestAnimationFrame(this.tick);
  };

  private stopMediaOnly(): void {
    this.currentSource?.stop();
    this.sourceNode?.disconnect();
    void this.audioContext?.close();
    this.currentSource = undefined;
    this.sourceNode = undefined;
    this.audioContext = undefined;
    this.analyser = undefined;
    this.frequencyData = new Uint8Array(0);
    this.waveformData = new Uint8Array(0);
  }

  private stopNativeSystemAudio(): void {
    this.nativeFeatureCleanup?.();
    this.nativeStatusCleanup?.();
    this.nativeFeatureCleanup = undefined;
    this.nativeStatusCleanup = undefined;
    void window.visualizerApi?.stopSystemAudio?.();
  }

  private setStatus(status: AudioSourceStatus, message: string): void {
    this.status = status;
    this.callbacks.onStatus(status, message);
  }
}

interface NativeFeaturePayload {
  type: 'features';
  features: {
    rms: number;
    bass: number;
    mid: number;
    treble: number;
    centroid: number;
    beatPulse: number;
    energy?: number;
    spectralFlux?: number;
    spectralFlatness?: number;
    spectralRolloff?: number;
    dynamicRange?: number;
    onsetPulse?: number;
    bassPulse?: number;
    midPulse?: number;
    treblePulse?: number;
    frequencyBins: number[];
    waveform: number[];
    bands?: number[];
    bandEnvelopes?: number[];
    bandPeaks?: number[];
    bandTransients?: number[];
    slowBands?: number[];
    timestampMs?: number;
    novelty?: number;
    onsetDensity?: number;
    loudnessTrend?: number;
    isSilent: boolean;
  };
}

interface NativeStatusPayload {
  type: 'status';
  status: AudioSourceStatus;
  message: string;
}

export function deserializeNativeFeatures(payload: unknown, sensitivity: number): AudioFeatures | null {
  if (!isNativeFeaturePayload(payload)) {
    return null;
  }

  const scale = (value: number): number => Math.min(1, Math.max(0, value * sensitivity));
  const scaleWaveform = (value: number): number => Math.min(1, Math.max(-1, value * sensitivity));
  const frequencyBins = Float32Array.from(payload.features.frequencyBins.map(scale));
  const waveform = Float32Array.from(payload.features.waveform.map(scaleWaveform));
  const bands = toScaledFloatArray(payload.features.bands, scale, VISUAL_BAND_COUNT, () =>
    resampleToBands(frequencyBins, VISUAL_BAND_COUNT)
  );
  const energy = scale(
    payload.features.energy ??
      Math.min(1, payload.features.rms * 1.2 + averageArray(bands) * 0.68 + payload.features.bass * 0.28)
  );

  return {
    timestampMs: payload.features.timestampMs ?? performance.now(),
    rms: scale(payload.features.rms),
    bass: scale(payload.features.bass),
    mid: scale(payload.features.mid),
    treble: scale(payload.features.treble),
    centroid: scale(payload.features.centroid),
    beatPulse: scale(payload.features.beatPulse),
    energy,
    spectralFlux: scale(payload.features.spectralFlux ?? 0),
    spectralFlatness: scale(payload.features.spectralFlatness ?? 0),
    spectralRolloff: scale(payload.features.spectralRolloff ?? payload.features.centroid),
    dynamicRange: scale(payload.features.dynamicRange ?? Math.min(1, payload.features.rms * 1.6)),
    onsetPulse: scale(payload.features.onsetPulse ?? payload.features.beatPulse),
    bassPulse: scale(payload.features.bassPulse ?? payload.features.beatPulse),
    midPulse: scale(payload.features.midPulse ?? 0),
    treblePulse: scale(payload.features.treblePulse ?? 0),
    frequencyBins,
    waveform,
    bands,
    bandEnvelopes: toScaledFloatArray(payload.features.bandEnvelopes, scale, VISUAL_BAND_COUNT, () => bands),
    bandPeaks: toScaledFloatArray(payload.features.bandPeaks, scale, VISUAL_BAND_COUNT, () => bands),
    bandTransients: toScaledFloatArray(payload.features.bandTransients, scale, VISUAL_BAND_COUNT, () => new Float32Array(VISUAL_BAND_COUNT)),
    slowBands: toScaledFloatArray(payload.features.slowBands, scale, VISUAL_BAND_COUNT, () => bands),
    novelty: scale(payload.features.novelty ?? payload.features.spectralFlux ?? 0),
    onsetDensity: scale(payload.features.onsetDensity ?? 0),
    loudnessTrend: Math.min(1, Math.max(-1, payload.features.loudnessTrend ?? 0)),
    isSilent: payload.features.isSilent
  };
}

function deserializeNativeStatus(payload: unknown): NativeStatusPayload | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const candidate = payload as Partial<NativeStatusPayload>;
  if (candidate.type !== 'status' || typeof candidate.status !== 'string' || typeof candidate.message !== 'string') {
    return null;
  }

  return candidate as NativeStatusPayload;
}

function isNativeFeaturePayload(payload: unknown): payload is NativeFeaturePayload {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const candidate = payload as Partial<NativeFeaturePayload>;
  const features = candidate.features;
  return (
    candidate.type === 'features' &&
    Boolean(features) &&
    typeof features?.rms === 'number' &&
    Array.isArray(features.frequencyBins) &&
    Array.isArray(features.waveform)
  );
}

function toScaledFloatArray(
  values: number[] | undefined,
  scale: (value: number) => number,
  fallbackLength: number,
  fallback: () => Float32Array
): Float32Array {
  if (!Array.isArray(values)) {
    return new Float32Array(fallback());
  }

  const output = new Float32Array(fallbackLength);
  for (let index = 0; index < fallbackLength; index += 1) {
    output[index] = scale(values[index] ?? 0);
  }
  return output;
}

function resampleToBands(values: Float32Array, count: number): Float32Array {
  const output = new Float32Array(count);
  if (values.length === 0) {
    return output;
  }

  for (let index = 0; index < count; index += 1) {
    const start = Math.floor((index / count) * values.length);
    const end = Math.max(start + 1, Math.floor(((index + 1) / count) * values.length));
    let sum = 0;
    for (let source = start; source < end; source += 1) {
      sum += values[source] ?? 0;
    }
    output[index] = sum / Math.max(1, end - start);
  }

  return output;
}

function averageArray(values: ArrayLike<number>): number {
  if (values.length === 0) {
    return 0;
  }

  let sum = 0;
  for (let index = 0; index < values.length; index += 1) {
    sum += values[index];
  }
  return sum / values.length;
}
