import type { AudioFeatures } from '../audio/types';
import type { PresetId, VisualDna, VisualEvolutionFrame } from './types';
import { SeededPrng, deriveSeed } from './prng';

export interface VisualEvolutionControllerOptions {
  seed: number;
  presetId: PresetId;
}

type DnaKey = keyof VisualDna;

const continuousKeys: DnaKey[] = [
  'mirrorMix',
  'flowDirection',
  'flowSpeed',
  'turbulence',
  'domainWarpScale',
  'domainWarpStrength',
  'noiseOctaves',
  'centerX',
  'centerY',
  'compositionX',
  'compositionY',
  'zoom',
  'rotationDrift',
  'feedbackRotation',
  'feedbackScale',
  'feedbackTranslateX',
  'feedbackTranslateY',
  'feedbackDecay',
  'feedbackDisplacement',
  'colorPhase',
  'paletteInterpolation',
  'brightnessDistribution',
  'fieldDensity',
  'topologyMix'
];

const discreteKeys: DnaKey[] = ['internalMode', 'coordinateSystem', 'symmetryCount'];

export class VisualEvolutionController {
  private readonly random: SeededPrng;
  private readonly seed: number;
  private current: VisualDna;
  private target: VisualDna;
  private elapsedMs = 0;
  private flow = 0;
  private event = 0;
  private macroEvent = 0;
  private mediumCooldownMs = 0;
  private macroCooldownMs = 0;
  private nextMediumMs = 0;
  private nextMacroMs = 0;

  constructor(options: VisualEvolutionControllerOptions) {
    this.seed = deriveSeed(options.seed, options.presetId);
    this.random = new SeededPrng(this.seed);
    this.current = createRandomDna(this.random);
    this.target = { ...this.current };
    this.scheduleMedium();
    this.scheduleMacro();
  }

  update(features: AudioFeatures, deltaMs: number): VisualEvolutionFrame {
    const delta = clamp(deltaMs, 0, 250);
    this.elapsedMs += delta;
    this.mediumCooldownMs = Math.max(0, this.mediumCooldownMs - delta);
    this.macroCooldownMs = Math.max(0, this.macroCooldownMs - delta);

    const transient = clamp(
      Math.max(features.onsetPulse, features.beatPulse * 0.82, features.bassPulse * 0.78, features.treblePulse * 0.62)
    );
    const novelty = clamp(features.novelty + features.spectralFlux * 0.35 + features.loudnessTrend * 0.12);
    const mediumBoundary = novelty > 0.42 || features.onsetDensity > 0.34 || transient > 0.62;
    const macroBoundary = novelty > 0.68 || (features.onsetDensity > 0.48 && features.dynamicRange > 0.18);

    if ((this.elapsedMs >= this.nextMediumMs || mediumBoundary) && this.mediumCooldownMs === 0) {
      this.mutateMedium(features);
    }

    if ((this.elapsedMs >= this.nextMacroMs || macroBoundary) && this.macroCooldownMs === 0) {
      this.mutateMacro(features);
    }

    const calmFactor = features.isSilent ? 0.42 : 1;
    const flowRate =
      (0.018 + this.current.flowSpeed * 0.11 + features.energy * 0.045 + features.spectralFlux * 0.035) * calmFactor;
    this.flow += (delta / 1000) * flowRate * directionFromAngle(this.current.flowDirection);
    this.event = Math.max(transient, this.event * Math.exp(-delta / 420));
    this.macroEvent *= Math.exp(-delta / 3_800);

    const responseMs = features.isSilent ? 7_800 : 4_600 - features.energy * 1_200;
    const alpha = exponentialAlpha(delta, responseMs);
    for (const key of continuousKeys) {
      this.current[key] = lerp(this.current[key], this.target[key], alpha);
    }
    for (const key of discreteKeys) {
      const deltaToTarget = this.target[key] - this.current[key];
      this.current[key] += deltaToTarget * exponentialAlpha(delta, 8_500);
    }

    return {
      seed: this.seed / 4_294_967_296,
      elapsedMs: this.elapsedMs,
      flow: this.flow,
      event: clamp(this.event),
      fastImpact: transient,
      macroEvent: clamp(this.macroEvent),
      novelty,
      dna: { ...this.current }
    };
  }

  macroVector(): number[] {
    return [
      this.current.internalMode,
      this.current.coordinateSystem,
      this.current.symmetryCount,
      this.current.flowDirection,
      this.current.domainWarpStrength,
      this.current.feedbackRotation,
      this.current.feedbackScale,
      this.current.colorPhase,
      this.current.topologyMix
    ].map((value) => Number(value.toFixed(4)));
  }

  get debugState(): { nextMediumMs: number; nextMacroMs: number; mediumCooldownMs: number; macroCooldownMs: number } {
    return {
      nextMediumMs: this.nextMediumMs,
      nextMacroMs: this.nextMacroMs,
      mediumCooldownMs: this.mediumCooldownMs,
      macroCooldownMs: this.macroCooldownMs
    };
  }

  private mutateMedium(features: AudioFeatures): void {
    const count = this.random.integer(2, features.spectralFlux > 0.38 ? 4 : 3);
    const keys = shuffleSubset(
      this.random,
      [
        'flowDirection',
        'flowSpeed',
        'turbulence',
        'domainWarpScale',
        'domainWarpStrength',
        'centerX',
        'centerY',
        'compositionX',
        'compositionY',
        'zoom',
        'rotationDrift',
        'fieldDensity',
        'brightnessDistribution'
      ] as DnaKey[],
      count
    );

    for (const key of keys) {
      this.target[key] = randomValueForKey(this.random, key);
    }

    if (features.midPulse > 0.44 || this.random.chance(0.24)) {
      this.target.symmetryCount = this.random.integer(2, 9);
      this.target.mirrorMix = this.random.range(0, 1);
    }

    this.event = Math.max(this.event, 0.55 + features.onsetPulse * 0.35);
    this.mediumCooldownMs = this.random.range(1_200, 3_400);
    this.scheduleMedium();
  }

  private mutateMacro(features: AudioFeatures): void {
    const modeBias = features.spectralRolloff > 0.58 ? 1 : 0;
    this.target.internalMode = this.random.integer(0, 4);
    this.target.coordinateSystem = this.random.integer(0, 5);
    this.target.topologyMix = clamp(this.random.range(0, 1) * 0.72 + modeBias * 0.18);
    this.target.paletteInterpolation = this.random.range(0, 1);
    this.target.feedbackRotation = this.random.range(-0.54, 0.54);
    this.target.feedbackScale = this.random.range(0.985, 1.018);
    this.target.feedbackDecay = this.random.range(0.858, 0.936);
    this.target.feedbackDisplacement = this.random.range(0.002, 0.032);
    this.target.colorPhase = wrap01(this.target.colorPhase + this.random.range(0.12, 0.42));
    this.target.flowDirection = this.random.range(0, 1);
    this.target.domainWarpStrength = this.random.range(0.08, 0.84);
    this.target.fieldDensity = this.random.range(0.18, 0.92);
    this.target.zoom = this.random.range(0.84, 1.28);

    this.macroEvent = 1;
    this.event = Math.max(this.event, 0.72);
    this.macroCooldownMs = this.random.range(12_000, 26_000);
    this.scheduleMacro();
  }

  private scheduleMedium(): void {
    this.nextMediumMs = this.elapsedMs + this.random.range(2_000, 12_000);
  }

  private scheduleMacro(): void {
    this.nextMacroMs = this.elapsedMs + this.random.range(15_000, 90_000);
  }
}

export function createRandomDna(random: SeededPrng): VisualDna {
  return {
    internalMode: random.integer(0, 4),
    coordinateSystem: random.integer(0, 5),
    symmetryCount: random.integer(2, 8),
    mirrorMix: random.range(0, 1),
    flowDirection: random.range(0, 1),
    flowSpeed: random.range(0.18, 0.88),
    turbulence: random.range(0.08, 0.78),
    domainWarpScale: random.range(0.45, 2.4),
    domainWarpStrength: random.range(0.08, 0.76),
    noiseOctaves: random.range(2.4, 5.6),
    centerX: random.range(-0.28, 0.28),
    centerY: random.range(-0.2, 0.2),
    compositionX: random.range(-0.36, 0.36),
    compositionY: random.range(-0.26, 0.26),
    zoom: random.range(0.88, 1.24),
    rotationDrift: random.range(-0.36, 0.36),
    feedbackRotation: random.range(-0.32, 0.32),
    feedbackScale: random.range(0.99, 1.012),
    feedbackTranslateX: random.range(-0.012, 0.012),
    feedbackTranslateY: random.range(-0.012, 0.012),
    feedbackDecay: random.range(0.87, 0.93),
    feedbackDisplacement: random.range(0.003, 0.024),
    colorPhase: random.range(0, 1),
    paletteInterpolation: random.range(0, 1),
    brightnessDistribution: random.range(0.22, 0.86),
    fieldDensity: random.range(0.22, 0.9),
    topologyMix: random.range(0, 1)
  };
}

export function exponentialAlpha(deltaMs: number, timeConstantMs: number): number {
  if (timeConstantMs <= 0) {
    return 1;
  }
  return clamp(1 - Math.exp(-Math.max(0, deltaMs) / timeConstantMs));
}

function randomValueForKey(random: SeededPrng, key: DnaKey): number {
  switch (key) {
    case 'flowDirection':
    case 'colorPhase':
    case 'paletteInterpolation':
    case 'topologyMix':
    case 'mirrorMix':
      return random.range(0, 1);
    case 'flowSpeed':
      return random.range(0.14, 1);
    case 'turbulence':
      return random.range(0.04, 0.96);
    case 'domainWarpScale':
      return random.range(0.34, 3.2);
    case 'domainWarpStrength':
      return random.range(0.04, 0.92);
    case 'noiseOctaves':
      return random.range(2, 6);
    case 'centerX':
    case 'compositionX':
      return random.range(-0.42, 0.42);
    case 'centerY':
    case 'compositionY':
      return random.range(-0.32, 0.32);
    case 'zoom':
      return random.range(0.78, 1.34);
    case 'rotationDrift':
      return random.range(-0.52, 0.52);
    case 'feedbackRotation':
      return random.range(-0.62, 0.62);
    case 'feedbackScale':
      return random.range(0.985, 1.02);
    case 'feedbackTranslateX':
    case 'feedbackTranslateY':
      return random.range(-0.02, 0.02);
    case 'feedbackDecay':
      return random.range(0.85, 0.94);
    case 'feedbackDisplacement':
      return random.range(0.002, 0.036);
    case 'brightnessDistribution':
      return random.range(0.16, 0.94);
    case 'fieldDensity':
      return random.range(0.12, 0.98);
    case 'internalMode':
      return random.integer(0, 4);
    case 'coordinateSystem':
      return random.integer(0, 5);
    case 'symmetryCount':
      return random.integer(2, 9);
  }
}

function shuffleSubset<T>(random: SeededPrng, values: T[], count: number): T[] {
  const pool = [...values];
  const output: T[] = [];
  while (output.length < count && pool.length > 0) {
    const index = random.integer(0, pool.length - 1);
    const [value] = pool.splice(index, 1);
    output.push(value);
  }
  return output;
}

function directionFromAngle(value: number): number {
  return value < 0.5 ? -1 : 1;
}

function wrap01(value: number): number {
  return ((value % 1) + 1) % 1;
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}
