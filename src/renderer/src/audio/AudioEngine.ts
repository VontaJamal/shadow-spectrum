import { FeatureExtractor } from './featureExtractor';
import { createAudioSource, transitionSourceStatus } from './sources';
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

    const source = createAudioSource(kind);
    this.currentSource = source;

    try {
      const stream = await source.start();
      this.status = transitionSourceStatus(source.status, 'stream-started');
      this.setStatus(this.status, `${source.label} active`);
      await this.connectStream(stream);
      this.tick();
    } catch (error) {
      const status = error instanceof DOMException && error.name === 'NotAllowedError' ? 'permission-denied' : 'error';
      this.setStatus(status, source.message);
      this.stopMediaOnly();
      throw error;
    }
  }

  stop(): void {
    window.cancelAnimationFrame(this.rafId);
    this.rafId = 0;
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

  private setStatus(status: AudioSourceStatus, message: string): void {
    this.status = status;
    this.callbacks.onStatus(status, message);
  }
}

