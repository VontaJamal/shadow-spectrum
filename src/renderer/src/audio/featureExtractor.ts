import type { AnalysisOptions, AudioFeatures } from './types';

interface ExtractOptions extends AnalysisOptions {
  sampleRate: number;
}

const emptyArray = new Float32Array(0);

export function createSilentAudioFeatures(): AudioFeatures {
  return {
    rms: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    centroid: 0,
    beatPulse: 0,
    frequencyBins: emptyArray,
    waveform: emptyArray,
    isSilent: true
  };
}

export class FeatureExtractor {
  private previousBass = 0;
  private previousPulse = 0;

  reset(): void {
    this.previousBass = 0;
    this.previousPulse = 0;
  }

  extract(frequencyData: Uint8Array, waveformData: Uint8Array, options: ExtractOptions): AudioFeatures {
    if (frequencyData.length === 0 || waveformData.length === 0) {
      return createSilentAudioFeatures();
    }

    const frequencyBins = normalizeByteArray(frequencyData, options.sensitivity);
    const waveform = normalizeWaveform(waveformData);
    const rms = calculateRms(waveform);
    const nyquist = options.sampleRate / 2;
    const bass = averageFrequencyRange(frequencyBins, 20, 250, nyquist);
    const mid = averageFrequencyRange(frequencyBins, 250, 4_000, nyquist);
    const treble = averageFrequencyRange(frequencyBins, 4_000, nyquist, nyquist);
    const centroid = calculateCentroid(frequencyBins, nyquist);
    const rawPulse = Math.max(0, bass - this.previousBass * 0.82) * 3.4;
    const beatPulse = clamp(rawPulse + this.previousPulse * 0.72);

    this.previousBass = bass;
    this.previousPulse = beatPulse;

    return {
      rms,
      bass,
      mid,
      treble,
      centroid,
      beatPulse,
      frequencyBins,
      waveform,
      isSilent: rms < options.silenceThreshold && bass < options.silenceThreshold && mid < options.silenceThreshold
    };
  }
}

function normalizeByteArray(data: Uint8Array, sensitivity: number): Float32Array {
  const normalized = new Float32Array(data.length);
  for (let index = 0; index < data.length; index += 1) {
    normalized[index] = clamp((data[index] / 255) * sensitivity);
  }
  return normalized;
}

function normalizeWaveform(data: Uint8Array): Float32Array {
  const normalized = new Float32Array(data.length);
  for (let index = 0; index < data.length; index += 1) {
    normalized[index] = clamp((data[index] - 128) / 128, -1, 1);
  }
  return normalized;
}

function calculateRms(waveform: Float32Array): number {
  let sum = 0;
  for (const value of waveform) {
    sum += value * value;
  }

  return Math.sqrt(sum / waveform.length);
}

function averageFrequencyRange(bins: Float32Array, minFrequency: number, maxFrequency: number, nyquist: number): number {
  const minIndex = Math.max(0, Math.floor((minFrequency / nyquist) * bins.length));
  const maxIndex = Math.min(bins.length - 1, Math.ceil((maxFrequency / nyquist) * bins.length));

  if (maxIndex < minIndex) {
    return 0;
  }

  let sum = 0;
  let count = 0;
  for (let index = minIndex; index <= maxIndex; index += 1) {
    sum += bins[index];
    count += 1;
  }

  return count > 0 ? sum / count : 0;
}

function calculateCentroid(bins: Float32Array, nyquist: number): number {
  let weighted = 0;
  let total = 0;

  for (let index = 0; index < bins.length; index += 1) {
    const frequency = (index / bins.length) * nyquist;
    const magnitude = bins[index];
    weighted += frequency * magnitude;
    total += magnitude;
  }

  if (total === 0) {
    return 0;
  }

  return clamp(weighted / total / nyquist);
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

