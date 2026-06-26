import type { AudioSource, AudioSourceEvent, AudioSourceKind, AudioSourceStatus } from './types';
import { SeededPrng, createSessionSeed, deriveSeed } from '../shared/prng';

export function transitionSourceStatus(status: AudioSourceStatus, event: AudioSourceEvent): AudioSourceStatus {
  if (event === 'request') {
    return 'requesting';
  }

  if (event === 'stream-started') {
    return 'active';
  }

  if (event === 'silence-detected' && status === 'active') {
    return 'silent';
  }

  if (event === 'audio-detected' && status === 'silent') {
    return 'active';
  }

  if (event === 'permission-denied') {
    return 'permission-denied';
  }

  if (event === 'unsupported') {
    return 'unsupported';
  }

  if (event === 'error') {
    return 'error';
  }

  if (event === 'stop') {
    return 'stopped';
  }

  return status;
}

export class UnsupportedCaptureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedCaptureError';
  }
}

export function isDesktopLoopbackSupported(platform = window.visualizerApi?.platform ?? navigator.platform): boolean {
  const normalized = platform.toLowerCase();
  return normalized === 'win32' || normalized === 'darwin';
}

export async function withCaptureTimeout<T>(capture: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId = 0;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error('Capture request timed out'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([capture, timeout]);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export function createAudioSource(kind: AudioSourceKind): AudioSource {
  if (kind === 'desktop-loopback') {
    return new DesktopLoopbackSource();
  }

  if (kind === 'microphone') {
    return new MicrophoneSource();
  }

  return new SyntheticDemoSource();
}

abstract class BrowserAudioSource implements AudioSource {
  status: AudioSourceStatus = 'idle';
  message = 'Ready';
  protected stream?: MediaStream;

  abstract id: AudioSourceKind;
  abstract label: string;
  abstract kind: AudioSourceKind;
  abstract start(): Promise<MediaStream>;

  stop(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.status = transitionSourceStatus(this.status, 'stop');
    this.message = 'Stopped';
  }

  getStream(): MediaStream | undefined {
    return this.stream;
  }
}

class DesktopLoopbackSource extends BrowserAudioSource {
  id = 'desktop-loopback' as const;
  label = 'Desktop audio';
  kind = 'desktop-loopback' as const;

  async start(): Promise<MediaStream> {
    this.status = transitionSourceStatus(this.status, 'request');
    this.message = 'Requesting desktop audio';

    if (!isDesktopLoopbackSupported()) {
      this.message = 'System audio capture is not available on this platform. Use Mic or Demo mode.';
      this.status = transitionSourceStatus(this.status, 'unsupported');
      throw new UnsupportedCaptureError(this.message);
    }

    const stream = await withCaptureTimeout(
      navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: 1,
          width: 1,
          height: 1
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      }),
      8_000
    );

    stream.getVideoTracks().forEach((track) => track.stop());

    if (stream.getAudioTracks().length === 0) {
      this.message = 'Desktop capture returned no audio track';
      this.status = transitionSourceStatus(this.status, 'error');
      stream.getTracks().forEach((track) => track.stop());
      throw new Error(this.message);
    }

    this.stream = stream;
    this.status = transitionSourceStatus(this.status, 'stream-started');
    this.message = 'Desktop audio connected';
    return stream;
  }
}

class MicrophoneSource extends BrowserAudioSource {
  id = 'microphone' as const;
  label = 'Microphone';
  kind = 'microphone' as const;

  async start(): Promise<MediaStream> {
    this.status = transitionSourceStatus(this.status, 'request');
    this.message = 'Requesting microphone';

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      },
      video: false
    });

    this.stream = stream;
    this.status = transitionSourceStatus(this.status, 'stream-started');
    this.message = 'Microphone connected';
    return stream;
  }
}

class SyntheticDemoSource extends BrowserAudioSource {
  id = 'synthetic-demo' as const;
  label = 'Demo signal';
  kind = 'synthetic-demo' as const;
  private audioContext?: AudioContext;
  private intervalId = 0;
  private oscillators: OscillatorNode[] = [];
  private noiseSource?: AudioBufferSourceNode;
  private seed = 0;

  async start(): Promise<MediaStream> {
    this.status = transitionSourceStatus(this.status, 'request');
    this.message = 'Starting demo source';

    this.seed = createSessionSeed();
    this.audioContext = new AudioContext();
    await this.audioContext.resume();

    const destination = this.audioContext.createMediaStreamDestination();
    const bass = this.audioContext.createOscillator();
    const mid = this.audioContext.createOscillator();
    const high = this.audioContext.createOscillator();
    const bassGain = this.audioContext.createGain();
    const midGain = this.audioContext.createGain();
    const highGain = this.audioContext.createGain();
    const noiseGain = this.audioContext.createGain();
    const noiseFilter = this.audioContext.createBiquadFilter();
    const noiseSource = createLoopingNoiseSource(this.audioContext, deriveSeed(this.seed, 'demo-noise'));

    bass.type = 'sine';
    bass.frequency.value = 72;
    bassGain.gain.value = 0;

    mid.type = 'sawtooth';
    mid.frequency.value = 260;
    midGain.gain.value = 0;

    high.type = 'triangle';
    high.frequency.value = 1_600;
    highGain.gain.value = 0;

    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 2_300;
    noiseGain.gain.value = 0;

    bass.connect(bassGain).connect(destination);
    mid.connect(midGain).connect(destination);
    high.connect(highGain).connect(destination);
    noiseSource.connect(noiseFilter).connect(noiseGain).connect(destination);
    bass.start();
    mid.start();
    high.start();
    noiseSource.start();
    this.oscillators = [bass, mid, high];
    this.noiseSource = noiseSource;

    const sequencer = new GenerativeDemoSequencer({ seed: this.seed });
    const startedAt = this.audioContext.currentTime;
    this.intervalId = window.setInterval(() => {
      if (!this.audioContext) {
        return;
      }

      const time = this.audioContext.currentTime - startedAt;
      const frame = sequencer.sample(time);
      const now = this.audioContext.currentTime;
      bass.frequency.setTargetAtTime(frame.bassFrequency, now, 0.035);
      mid.frequency.setTargetAtTime(frame.midFrequency, now, 0.045);
      high.frequency.setTargetAtTime(frame.highFrequency, now, 0.025);
      noiseFilter.frequency.setTargetAtTime(frame.highFrequency * 1.35, now, 0.045);
      bassGain.gain.setTargetAtTime(frame.bassGain, now, 0.025);
      midGain.gain.setTargetAtTime(frame.midGain, now, 0.04);
      highGain.gain.setTargetAtTime(frame.highGain, now, 0.025);
      noiseGain.gain.setTargetAtTime(frame.noiseGain, now, 0.018);
    }, 35);

    this.stream = destination.stream;
    this.status = transitionSourceStatus(this.status, 'stream-started');
    this.message = 'Demo source active';
    return destination.stream;
  }

  override stop(): void {
    window.clearInterval(this.intervalId);
    this.oscillators.forEach((oscillator) => {
      try {
        oscillator.stop();
      } catch {
        // The audio context may already be closed.
      }
    });
    try {
      this.noiseSource?.stop();
    } catch {
      // The audio context may already be closed.
    }
    this.oscillators = [];
    this.noiseSource = undefined;
    void this.audioContext?.close();
    this.audioContext = undefined;
    super.stop();
  }
}

export interface DemoSequencerOptions {
  seed: number;
}

export interface DemoSignalFrame {
  timeSeconds: number;
  phraseIndex: number;
  bassFrequency: number;
  midFrequency: number;
  highFrequency: number;
  bassGain: number;
  midGain: number;
  highGain: number;
  noiseGain: number;
  restAmount: number;
  spectralTilt: number;
}

export class GenerativeDemoSequencer {
  private readonly random: SeededPrng;
  private phraseIndex = -1;
  private phraseEnd = 0;
  private beatSeconds = 0.52;
  private nextKick = 0;
  private nextMid = 0;
  private nextHigh = 0;
  private lastKick = -99;
  private lastMid = -99;
  private lastHigh = -99;
  private restUntil = 0;
  private density = 0.5;
  private spectralTilt = 0.5;
  private bassBase = 72;
  private midBase = 280;
  private highBase = 1_900;

  constructor(options: DemoSequencerOptions) {
    this.random = new SeededPrng(options.seed);
    this.startNextPhrase(0);
  }

  sample(timeSeconds: number): DemoSignalFrame {
    const time = Math.max(0, timeSeconds);
    while (time >= this.phraseEnd) {
      this.startNextPhrase(this.phraseEnd);
    }
    this.advanceEvents(time);

    const restAmount = time < this.restUntil ? 0.72 : 0;
    const kickEnvelope = envelope(time - this.lastKick, 0.045, 0.34);
    const midEnvelope = envelope(time - this.lastMid, 0.08, 0.62);
    const highEnvelope = envelope(time - this.lastHigh, 0.018, 0.16);
    const sectionPosition = clamp((time - (this.phraseEnd - this.beatSeconds * 16)) / Math.max(0.001, this.beatSeconds * 16));
    const phraseLift = 0.82 + sectionPosition * 0.18;
    const restScale = 1 - restAmount;

    return {
      timeSeconds: time,
      phraseIndex: this.phraseIndex,
      bassFrequency: this.bassBase * (1 + kickEnvelope * 0.08),
      midFrequency: this.midBase * (1 + midEnvelope * 0.18 + this.spectralTilt * 0.08),
      highFrequency: this.highBase * (1 + highEnvelope * 0.32 + this.spectralTilt * 0.18),
      bassGain: (0.035 + kickEnvelope * 0.52 + this.density * 0.08) * restScale,
      midGain: (0.012 + midEnvelope * 0.19 + this.density * 0.045) * restScale * phraseLift,
      highGain: (0.004 + highEnvelope * 0.11 + this.spectralTilt * 0.018) * restScale,
      noiseGain: (highEnvelope * 0.13 + this.spectralTilt * 0.016) * restScale,
      restAmount,
      spectralTilt: this.spectralTilt
    };
  }

  private startNextPhrase(startTime: number): void {
    this.phraseIndex += 1;
    const beats = this.random.integer(11, 29);
    const tempo = this.random.range(82, 148);
    this.beatSeconds = 60 / tempo;
    this.phraseEnd = startTime + beats * this.beatSeconds;
    this.density = this.random.range(0.28, 0.92);
    this.spectralTilt = this.random.range(0.14, 0.9);
    this.bassBase = this.random.range(46, 96);
    this.midBase = this.random.range(170, 620);
    this.highBase = this.random.range(1_200, 4_800);
    this.nextKick = startTime + this.random.range(0.02, this.beatSeconds * 0.6);
    this.nextMid = startTime + this.random.range(this.beatSeconds * 0.4, this.beatSeconds * 1.8);
    this.nextHigh = startTime + this.random.range(this.beatSeconds * 0.2, this.beatSeconds * 1.2);
    if (this.random.chance(0.22)) {
      this.restUntil = startTime + this.random.range(this.beatSeconds * 1.2, this.beatSeconds * 3.8);
    }
  }

  private advanceEvents(time: number): void {
    while (time >= this.nextKick) {
      this.lastKick = this.nextKick;
      const skip = this.random.chance(0.12 + (1 - this.density) * 0.2) ? 2 : 1;
      this.nextKick += this.beatSeconds * skip * this.random.range(0.82, 1.42);
      if (this.random.chance(0.08)) {
        this.restUntil = this.nextKick + this.random.range(this.beatSeconds * 0.7, this.beatSeconds * 2.5);
      }
    }

    while (time >= this.nextMid) {
      this.lastMid = this.nextMid;
      this.nextMid += this.beatSeconds * this.random.range(0.72, 2.9 - this.density);
      if (this.random.chance(0.28)) {
        this.midBase = this.random.range(160, 720);
      }
    }

    while (time >= this.nextHigh) {
      this.lastHigh = this.nextHigh;
      this.nextHigh += this.beatSeconds * this.random.range(0.28, 1.8);
      if (this.random.chance(0.18)) {
        this.highBase = this.random.range(1_200, 5_600);
      }
    }
  }
}

function createLoopingNoiseSource(audioContext: AudioContext, seed: number): AudioBufferSourceNode {
  const random = new SeededPrng(seed);
  const length = audioContext.sampleRate * 2;
  const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let index = 0; index < data.length; index += 1) {
    last = last * 0.58 + (random.next() * 2 - 1) * 0.42;
    data[index] = last;
  }

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  return source;
}

function envelope(ageSeconds: number, attackSeconds: number, releaseSeconds: number): number {
  if (ageSeconds < 0) {
    return 0;
  }
  if (ageSeconds < attackSeconds) {
    return clamp(ageSeconds / Math.max(0.001, attackSeconds));
  }
  return Math.exp(-(ageSeconds - attackSeconds) / Math.max(0.001, releaseSeconds));
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}
