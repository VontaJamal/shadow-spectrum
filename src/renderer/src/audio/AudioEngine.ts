import { FeatureExtractor } from './featureExtractor';
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

    const waveformData = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteFrequencyData(this.frequencyData);
    this.analyser.getByteTimeDomainData(waveformData);

    const features = this.extractor.extract(this.frequencyData, waveformData, {
      ...this.options,
      sampleRate: this.audioContext.sampleRate
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
    frequencyBins: number[];
    waveform: number[];
    isSilent: boolean;
  };
}

interface NativeStatusPayload {
  type: 'status';
  status: AudioSourceStatus;
  message: string;
}

function deserializeNativeFeatures(payload: unknown, sensitivity: number): AudioFeatures | null {
  if (!isNativeFeaturePayload(payload)) {
    return null;
  }

  const scale = (value: number): number => Math.min(1, Math.max(0, value * sensitivity));
  const scaleWaveform = (value: number): number => Math.min(1, Math.max(-1, value * sensitivity));

  return {
    rms: scale(payload.features.rms),
    bass: scale(payload.features.bass),
    mid: scale(payload.features.mid),
    treble: scale(payload.features.treble),
    centroid: scale(payload.features.centroid),
    beatPulse: scale(payload.features.beatPulse),
    frequencyBins: Float32Array.from(payload.features.frequencyBins.map(scale)),
    waveform: Float32Array.from(payload.features.waveform.map(scaleWaveform)),
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
