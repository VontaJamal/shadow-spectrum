import type { AnalysisOptions, AudioFeatures } from './types';

interface ExtractOptions extends AnalysisOptions {
  sampleRate: number;
  timestampMs?: number;
}

interface TimedSample {
  timeMs: number;
  value: number;
}

export const VISUAL_BAND_COUNT = 24;
const historyWindowMs = 8_000;
const onsetDensityWindowMs = 6_000;
const minimumBandFrequency = 35;

export function createSilentAudioFeatures(timestampMs = 0): AudioFeatures {
  const bands = new Float32Array(VISUAL_BAND_COUNT);
  return {
    timestampMs,
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
    frequencyBins: new Float32Array(0),
    waveform: new Float32Array(0),
    bands,
    bandEnvelopes: new Float32Array(VISUAL_BAND_COUNT),
    bandPeaks: new Float32Array(VISUAL_BAND_COUNT),
    bandTransients: new Float32Array(VISUAL_BAND_COUNT),
    slowBands: new Float32Array(VISUAL_BAND_COUNT),
    novelty: 0,
    onsetDensity: 0,
    loudnessTrend: 0,
    isSilent: true
  };
}

export class FeatureExtractor {
  private readonly normalizer = new AdaptiveBandNormalizer();
  private bandEnvelopes = new Float32Array(VISUAL_BAND_COUNT);
  private bandPeaks = new Float32Array(VISUAL_BAND_COUNT);
  private bandTransients = new Float32Array(VISUAL_BAND_COUNT);
  private slowBands = new Float32Array(VISUAL_BAND_COUNT);
  private energyHistory = new TimedHistory(historyWindowMs);
  private bassHistory = new TimedHistory(historyWindowMs);
  private midHistory = new TimedHistory(historyWindowMs);
  private trebleHistory = new TimedHistory(historyWindowMs);
  private onsetHistory = new TimedHistory(onsetDensityWindowMs);
  private previousFrequencyBins: Float32Array<ArrayBufferLike> = new Float32Array(0);
  private previousBands = new Float32Array(VISUAL_BAND_COUNT);
  private previousOnsetPulse = 0;
  private previousBassPulse = 0;
  private previousMidPulse = 0;
  private previousTreblePulse = 0;
  private lastTimestampMs: number | null = null;

  reset(): void {
    this.normalizer.reset();
    this.bandEnvelopes = new Float32Array(VISUAL_BAND_COUNT);
    this.bandPeaks = new Float32Array(VISUAL_BAND_COUNT);
    this.bandTransients = new Float32Array(VISUAL_BAND_COUNT);
    this.slowBands = new Float32Array(VISUAL_BAND_COUNT);
    this.energyHistory.clear();
    this.bassHistory.clear();
    this.midHistory.clear();
    this.trebleHistory.clear();
    this.onsetHistory.clear();
    this.previousFrequencyBins = new Float32Array(0);
    this.previousBands = new Float32Array(VISUAL_BAND_COUNT);
    this.previousOnsetPulse = 0;
    this.previousBassPulse = 0;
    this.previousMidPulse = 0;
    this.previousTreblePulse = 0;
    this.lastTimestampMs = null;
  }

  extract(frequencyData: Uint8Array, waveformData: Uint8Array, options: ExtractOptions): AudioFeatures {
    const timestampMs = options.timestampMs ?? globalThis.performance?.now?.() ?? Date.now();
    if (frequencyData.length === 0 || waveformData.length === 0) {
      return createSilentAudioFeatures(timestampMs);
    }

    const deltaMs =
      this.lastTimestampMs === null ? 1000 / 60 : Math.min(250, Math.max(1, timestampMs - this.lastTimestampMs));
    this.lastTimestampMs = timestampMs;

    const frequencyBins = normalizeByteArray(frequencyData, options.sensitivity);
    const waveform = normalizeWaveform(waveformData);
    const rms = calculateRms(waveform);
    const nyquist = options.sampleRate / 2;
    const bass = averageFrequencyRange(frequencyBins, 20, 250, nyquist);
    const mid = averageFrequencyRange(frequencyBins, 250, 4_000, nyquist);
    const treble = averageFrequencyRange(frequencyBins, 4_000, nyquist, nyquist);
    const centroid = calculateCentroid(frequencyBins, nyquist);
    const rawBands = calculateLogBands(frequencyBins, nyquist, VISUAL_BAND_COUNT);
    const bands = this.normalizer.update(rawBands, deltaMs);
    const averageBandEnergy = averageArray(bands);
    const energy = clamp(rms * 1.2 + averageBandEnergy * 0.68 + bass * 0.28);
    const spectralFlux = calculateSpectralFlux(frequencyBins, this.previousFrequencyBins);
    const spectralFlatness = calculateSpectralFlatness(frequencyBins);
    const spectralRolloff = calculateSpectralRolloff(frequencyBins, 0.85);
    const dynamicRange = calculateDynamicRange(waveform, rms);
    const bandProfileDelta = calculateBandProfileDelta(bands, this.previousBands);
    const loudnessTrend = this.energyHistory.normalizedTrend(energy);
    const novelty = clamp(spectralFlux * 0.42 + bandProfileDelta * 0.95 + Math.max(0, loudnessTrend) * 0.26 + dynamicRange * 0.08);
    const onsetPulse = adaptivePulse(energy + spectralFlux * 0.35 + novelty * 0.16, this.energyHistory, this.previousOnsetPulse, {
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

    updateBandEnvelopeState(this.bandEnvelopes, this.bandPeaks, bands, deltaMs);
    updateBandTransientState(this.bandTransients, bands, this.previousBands, deltaMs);
    updateSlowBandState(this.slowBands, bands, deltaMs);

    if (onsetPulse > 0.18 || bassPulse > 0.28) {
      this.onsetHistory.push(timestampMs, 1);
    } else {
      this.onsetHistory.prune(timestampMs);
    }
    const onsetDensity = clamp(this.onsetHistory.count / 12);

    this.energyHistory.push(timestampMs, energy);
    this.bassHistory.push(timestampMs, bass);
    this.midHistory.push(timestampMs, mid);
    this.trebleHistory.push(timestampMs, treble);
    this.previousFrequencyBins = frequencyBins;
    this.previousBands = new Float32Array(bands);
    this.previousOnsetPulse = onsetPulse;
    this.previousBassPulse = bassPulse;
    this.previousMidPulse = midPulse;
    this.previousTreblePulse = treblePulse;

    return {
      timestampMs,
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
      bandTransients: new Float32Array(this.bandTransients),
      slowBands: new Float32Array(this.slowBands),
      novelty,
      onsetDensity,
      loudnessTrend,
      isSilent: rms < options.silenceThreshold && energy < options.silenceThreshold && bass < options.silenceThreshold
    };
  }
}

class TimedHistory {
  private samples: TimedSample[] = [];

  constructor(private readonly windowMs: number) {}

  get count(): number {
    return this.samples.length;
  }

  push(timeMs: number, value: number): void {
    this.samples.push({ timeMs, value });
    this.prune(timeMs);
  }

  prune(timeMs: number): void {
    const cutoff = timeMs - this.windowMs;
    while (this.samples.length > 0 && this.samples[0].timeMs < cutoff) {
      this.samples.shift();
    }
  }

  clear(): void {
    this.samples = [];
  }

  average(): number {
    if (this.samples.length === 0) {
      return 0;
    }
    let sum = 0;
    for (const sample of this.samples) {
      sum += sample.value;
    }
    return sum / this.samples.length;
  }

  variance(mean = this.average()): number {
    if (this.samples.length === 0) {
      return 0;
    }
    let sum = 0;
    for (const sample of this.samples) {
      const delta = sample.value - mean;
      sum += delta * delta;
    }
    return sum / this.samples.length;
  }

  normalizedTrend(value: number): number {
    if (this.samples.length < 2) {
      return 0;
    }
    const baseline = this.average();
    const spread = Math.sqrt(this.variance(baseline));
    return clamp((value - baseline) / Math.max(0.035, spread + 0.02), -1, 1);
  }
}

class AdaptiveBandNormalizer {
  private floors = new Float32Array(VISUAL_BAND_COUNT);
  private ceilings = new Float32Array(VISUAL_BAND_COUNT).fill(0.08);

  reset(): void {
    this.floors = new Float32Array(VISUAL_BAND_COUNT);
    this.ceilings = new Float32Array(VISUAL_BAND_COUNT).fill(0.08);
  }

  update(rawBands: Float32Array, deltaMs: number): Float32Array {
    const output = new Float32Array(VISUAL_BAND_COUNT);
    const floorRise = exponentialAlpha(deltaMs, 12_000);
    const floorFall = exponentialAlpha(deltaMs, 520);
    const ceilingRise = exponentialAlpha(deltaMs, 160);
    const ceilingFall = exponentialAlpha(deltaMs, 9_500);

    for (let index = 0; index < VISUAL_BAND_COUNT; index += 1) {
      const raw = clamp(rawBands[index] ?? 0);
      const floorAlpha = raw < this.floors[index] ? floorFall : floorRise;
      const ceilingAlpha = raw > this.ceilings[index] ? ceilingRise : ceilingFall;
      this.floors[index] = lerp(this.floors[index], raw * 0.62, floorAlpha);
      this.ceilings[index] = lerp(this.ceilings[index], Math.max(raw, 0.075), ceilingAlpha);
      const range = Math.max(0.045, this.ceilings[index] - this.floors[index]);
      output[index] = clamp((raw - this.floors[index] * 0.72) / range);
    }

    return output;
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

function calculateBandProfileDelta(current: Float32Array, previous: Float32Array): number {
  if (previous.length !== current.length) {
    return 0;
  }

  let sum = 0;
  for (let index = 0; index < current.length; index += 1) {
    sum += Math.abs(current[index] - previous[index]);
  }
  return clamp(sum / current.length);
}

interface AdaptivePulseOptions {
  floor: number;
  sensitivity: number;
  spreadScale: number;
}

function adaptivePulse(value: number, history: TimedHistory, previousPulse: number, options: AdaptivePulseOptions): number {
  if (history.count === 0) {
    return 0;
  }

  const baseline = history.average();
  const spread = Math.sqrt(history.variance(baseline));
  const threshold = baseline + spread * options.spreadScale + options.floor;
  const lift = Math.max(0, value - threshold);
  const normalizedLift = lift / Math.max(options.floor * 1.6, spread + options.floor);
  return clamp(normalizedLift * options.sensitivity + previousPulse * 0.58);
}

function updateBandEnvelopeState(envelopes: Float32Array, peaks: Float32Array, bands: Float32Array, deltaMs: number): void {
  const attack = exponentialAlpha(deltaMs, 42);
  const release = exponentialAlpha(deltaMs, 360);
  const peakDecay = Math.exp(-deltaMs / 1_900);
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index] ?? 0;
    const envelope = envelopes[index] ?? 0;
    envelopes[index] = lerp(envelope, band, band > envelope ? attack : release);
    peaks[index] = Math.max(band, (peaks[index] ?? 0) * peakDecay);
  }
}

function updateBandTransientState(transients: Float32Array, bands: Float32Array, previousBands: Float32Array, deltaMs: number): void {
  const decay = Math.exp(-deltaMs / 140);
  for (let index = 0; index < bands.length; index += 1) {
    const lift = Math.max(0, (bands[index] ?? 0) - (previousBands[index] ?? 0));
    transients[index] = Math.max(lift * 1.8, transients[index] * decay);
  }
}

function updateSlowBandState(slowBands: Float32Array, bands: Float32Array, deltaMs: number): void {
  const alpha = exponentialAlpha(deltaMs, 2_600);
  for (let index = 0; index < bands.length; index += 1) {
    slowBands[index] = lerp(slowBands[index] ?? 0, bands[index] ?? 0, alpha);
  }
}

function exponentialAlpha(deltaMs: number, timeConstantMs: number): number {
  return clamp(1 - Math.exp(-Math.max(0, deltaMs) / timeConstantMs));
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

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * clamp(alpha);
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}
