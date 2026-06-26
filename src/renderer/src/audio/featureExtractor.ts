import type { AnalysisOptions, AudioFeatures } from './types';

interface ExtractOptions extends AnalysisOptions {
  sampleRate: number;
}

const emptyArray = new Float32Array(0);
export const VISUAL_BAND_COUNT = 24;
const HISTORY_SIZE = 64;
const minimumBandFrequency = 35;

export function createSilentAudioFeatures(): AudioFeatures {
  return {
    rms: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    centroid: 0,
    beatPulse: 0,
    energy: 0,
    spectralFlux: 0,
    spectralFlatness: 0,
    spectralRolloff: 0,
    dynamicRange: 0,
    onsetPulse: 0,
    bassPulse: 0,
    midPulse: 0,
    treblePulse: 0,
    frequencyBins: emptyArray,
    waveform: emptyArray,
    bands: emptyArray,
    bandEnvelopes: emptyArray,
    bandPeaks: emptyArray,
    isSilent: true
  };
}

export class FeatureExtractor {
  private bandEnvelopes = new Float32Array(VISUAL_BAND_COUNT);
  private bandPeaks = new Float32Array(VISUAL_BAND_COUNT);
  private energyHistory: number[] = [];
  private bassHistory: number[] = [];
  private midHistory: number[] = [];
  private trebleHistory: number[] = [];
  private previousFrequencyBins: Float32Array<ArrayBufferLike> = new Float32Array(0);
  private previousOnsetPulse = 0;
  private previousBassPulse = 0;
  private previousMidPulse = 0;
  private previousTreblePulse = 0;

  reset(): void {
    this.bandEnvelopes = new Float32Array(VISUAL_BAND_COUNT);
    this.bandPeaks = new Float32Array(VISUAL_BAND_COUNT);
    this.energyHistory = [];
    this.bassHistory = [];
    this.midHistory = [];
    this.trebleHistory = [];
    this.previousFrequencyBins = new Float32Array(0);
    this.previousOnsetPulse = 0;
    this.previousBassPulse = 0;
    this.previousMidPulse = 0;
    this.previousTreblePulse = 0;
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
    const bands = calculateLogBands(frequencyBins, nyquist, VISUAL_BAND_COUNT);
    const averageBandEnergy = averageArray(bands);
    const energy = clamp(rms * 1.2 + averageBandEnergy * 0.68 + bass * 0.28);
    const spectralFlux = calculateSpectralFlux(frequencyBins, this.previousFrequencyBins);
    const spectralFlatness = calculateSpectralFlatness(frequencyBins);
    const spectralRolloff = calculateSpectralRolloff(frequencyBins, 0.85);
    const dynamicRange = calculateDynamicRange(waveform, rms);
    const onsetPulse = adaptivePulse(energy + spectralFlux * 0.35, this.energyHistory, this.previousOnsetPulse, {
      floor: 0.018,
      sensitivity: 1.35,
      spreadScale: 1.65
    });
    const bassPulse = adaptivePulse(bass, this.bassHistory, this.previousBassPulse, {
      floor: 0.014,
      sensitivity: 1.6,
      spreadScale: 1.45
    });
    const midPulse = adaptivePulse(mid, this.midHistory, this.previousMidPulse, {
      floor: 0.016,
      sensitivity: 1.28,
      spreadScale: 1.55
    });
    const treblePulse = adaptivePulse(treble, this.trebleHistory, this.previousTreblePulse, {
      floor: 0.016,
      sensitivity: 1.22,
      spreadScale: 1.55
    });
    const beatPulse = clamp(Math.max(bassPulse, onsetPulse * 0.78));

    updateBandEnvelopeState(this.bandEnvelopes, this.bandPeaks, bands);
    pushHistory(this.energyHistory, energy);
    pushHistory(this.bassHistory, bass);
    pushHistory(this.midHistory, mid);
    pushHistory(this.trebleHistory, treble);
    this.previousFrequencyBins = frequencyBins;
    this.previousOnsetPulse = onsetPulse;
    this.previousBassPulse = bassPulse;
    this.previousMidPulse = midPulse;
    this.previousTreblePulse = treblePulse;

    return {
      rms,
      bass,
      mid,
      treble,
      centroid,
      beatPulse,
      energy,
      spectralFlux,
      spectralFlatness,
      spectralRolloff,
      dynamicRange,
      onsetPulse,
      bassPulse,
      midPulse,
      treblePulse,
      frequencyBins,
      waveform,
      bands,
      bandEnvelopes: new Float32Array(this.bandEnvelopes),
      bandPeaks: new Float32Array(this.bandPeaks),
      isSilent: rms < options.silenceThreshold && energy < options.silenceThreshold && bass < options.silenceThreshold
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

function calculateLogBands(bins: Float32Array, nyquist: number, count: number): Float32Array {
  if (bins.length === 0) {
    return new Float32Array(count);
  }

  const bands = new Float32Array(count);
  const maximumFrequency = Math.max(minimumBandFrequency + 1, nyquist);
  const logMinimum = Math.log10(minimumBandFrequency);
  const logMaximum = Math.log10(maximumFrequency);

  for (let band = 0; band < count; band += 1) {
    const startFrequency = Math.pow(10, logMinimum + (band / count) * (logMaximum - logMinimum));
    const endFrequency = Math.pow(10, logMinimum + ((band + 1) / count) * (logMaximum - logMinimum));
    bands[band] = averageFrequencyRange(bins, startFrequency, endFrequency, nyquist);
  }

  return bands;
}

function calculateSpectralFlux(current: Float32Array, previous: Float32Array): number {
  if (current.length === 0 || previous.length !== current.length) {
    return 0;
  }

  let sum = 0;
  for (let index = 0; index < current.length; index += 1) {
    sum += Math.max(0, current[index] - previous[index]);
  }

  return clamp((sum / current.length) * 3.2);
}

function calculateSpectralFlatness(bins: Float32Array): number {
  if (bins.length === 0) {
    return 0;
  }

  let logSum = 0;
  let arithmeticSum = 0;
  const epsilon = 0.000_001;

  for (const bin of bins) {
    const magnitude = Math.max(epsilon, bin);
    logSum += Math.log(magnitude);
    arithmeticSum += magnitude;
  }

  const geometricMean = Math.exp(logSum / bins.length);
  const arithmeticMean = arithmeticSum / bins.length;
  return arithmeticMean <= epsilon ? 0 : clamp(geometricMean / arithmeticMean);
}

function calculateSpectralRolloff(bins: Float32Array, threshold: number): number {
  let total = 0;
  for (const bin of bins) {
    total += bin;
  }

  if (total === 0 || bins.length === 0) {
    return 0;
  }

  const target = total * threshold;
  let running = 0;
  for (let index = 0; index < bins.length; index += 1) {
    running += bins[index];
    if (running >= target) {
      return clamp(index / Math.max(1, bins.length - 1));
    }
  }

  return 1;
}

function calculateDynamicRange(waveform: Float32Array, rms: number): number {
  let peak = 0;
  for (const sample of waveform) {
    peak = Math.max(peak, Math.abs(sample));
  }

  return clamp((peak - rms) * 1.7);
}

interface AdaptivePulseOptions {
  floor: number;
  sensitivity: number;
  spreadScale: number;
}

function adaptivePulse(value: number, history: number[], previousPulse: number, options: AdaptivePulseOptions): number {
  if (history.length === 0) {
    return 0;
  }

  const baseline = averageArray(history);
  const spread = Math.sqrt(variance(history, baseline));
  const threshold = baseline + spread * options.spreadScale + options.floor;
  const lift = Math.max(0, value - threshold);
  const normalizedLift = lift / Math.max(options.floor * 1.6, spread + options.floor);
  return clamp(normalizedLift * options.sensitivity + previousPulse * 0.58);
}

function updateBandEnvelopeState(envelopes: Float32Array, peaks: Float32Array, bands: Float32Array): void {
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index] ?? 0;
    const envelope = envelopes[index] ?? 0;
    const attack = band > envelope ? 0.58 : 0.13;
    envelopes[index] = lerp(envelope, band, attack);
    peaks[index] = Math.max(band, (peaks[index] ?? 0) * 0.965);
  }
}

function pushHistory(history: number[], value: number): void {
  history.push(value);
  if (history.length > HISTORY_SIZE) {
    history.shift();
  }
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

function variance(values: number[], mean: number): number {
  if (values.length === 0) {
    return 0;
  }

  let sum = 0;
  for (const value of values) {
    const delta = value - mean;
    sum += delta * delta;
  }

  return sum / values.length;
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * clamp(alpha);
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}
