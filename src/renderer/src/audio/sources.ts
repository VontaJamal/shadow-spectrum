import type { AudioSource, AudioSourceEvent, AudioSourceKind, AudioSourceStatus } from './types';

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

  if (event === 'error') {
    return 'error';
  }

  if (event === 'stop') {
    return 'stopped';
  }

  return status;
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

    const stream = await navigator.mediaDevices.getDisplayMedia({
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
    });

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

  async start(): Promise<MediaStream> {
    this.status = transitionSourceStatus(this.status, 'request');
    this.message = 'Starting demo source';

    this.audioContext = new AudioContext();
    await this.audioContext.resume();

    const destination = this.audioContext.createMediaStreamDestination();
    const bass = this.audioContext.createOscillator();
    const treble = this.audioContext.createOscillator();
    const bassGain = this.audioContext.createGain();
    const trebleGain = this.audioContext.createGain();

    bass.type = 'sine';
    bass.frequency.value = 86;
    bassGain.gain.value = 0.4;

    treble.type = 'triangle';
    treble.frequency.value = 820;
    trebleGain.gain.value = 0.08;

    bass.connect(bassGain).connect(destination);
    treble.connect(trebleGain).connect(destination);
    bass.start();
    treble.start();

    const startedAt = this.audioContext.currentTime;
    this.intervalId = window.setInterval(() => {
      if (!this.audioContext) {
        return;
      }

      const time = this.audioContext.currentTime - startedAt;
      bass.frequency.setTargetAtTime(70 + Math.sin(time * 1.9) * 24, this.audioContext.currentTime, 0.08);
      treble.frequency.setTargetAtTime(520 + Math.sin(time * 0.7) * 260, this.audioContext.currentTime, 0.08);
      bassGain.gain.setTargetAtTime(0.18 + Math.max(0, Math.sin(time * 3.2)) * 0.42, this.audioContext.currentTime, 0.05);
      trebleGain.gain.setTargetAtTime(0.05 + Math.max(0, Math.sin(time * 5.1)) * 0.18, this.audioContext.currentTime, 0.05);
    }, 80);

    this.stream = destination.stream;
    this.status = transitionSourceStatus(this.status, 'stream-started');
    this.message = 'Demo source active';
    return destination.stream;
  }

  override stop(): void {
    window.clearInterval(this.intervalId);
    void this.audioContext?.close();
    this.audioContext = undefined;
    super.stop();
  }
}

