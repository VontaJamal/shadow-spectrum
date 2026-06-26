import * as THREE from 'three';
import type { AudioFeatures } from '../audio/types';
import type { Palette, PresetId, Size, VisualizerPreset } from './types';

export function createPreset(id: PresetId, palette: Palette): VisualizerPreset {
  if (id === 'electric-fold') {
    return new ElectricFoldPreset(palette);
  }

  if (id === 'liquid-veil') {
    return new LiquidVeilPreset(palette);
  }

  if (id === 'plasma-bowl') {
    return new PlasmaBowlPreset(palette);
  }

  return new VortexEyePreset(palette);
}

interface VisualSignal {
  rms: number;
  bass: number;
  mid: number;
  treble: number;
  centroid: number;
  pulse: number;
  energy: number;
  flux: number;
  flatness: number;
  rolloff: number;
  dynamics: number;
  onset: number;
  bassPulse: number;
  midPulse: number;
  treblePulse: number;
}

const initialSignal: VisualSignal = {
  rms: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  centroid: 0,
  pulse: 0,
  energy: 0,
  flux: 0,
  flatness: 0,
  rolloff: 0,
  dynamics: 0,
  onset: 0,
  bassPulse: 0,
  midPulse: 0,
  treblePulse: 0
};

abstract class PresetBase implements VisualizerPreset {
  abstract id: PresetId;
  abstract name: string;
  protected group = new THREE.Group();
  protected size: Size = { width: 1, height: 1 };
  private signal: VisualSignal = { ...initialSignal };

  constructor(protected readonly palette: Palette) {}

  init(scene: THREE.Scene): void {
    scene.add(this.group);
    this.build();
  }

  resize(size: Size): void {
    this.size = size;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((object) => {
      const renderable = object as THREE.Mesh | THREE.Points | THREE.Line;
      renderable.geometry?.dispose();
      const material = renderable.material;
      if (Array.isArray(material)) {
        material.forEach((entry) => entry.dispose());
      } else {
        material?.dispose();
      }
    });
    this.group.clear();
  }

  protected readSignal(features: AudioFeatures, deltaMs: number): VisualSignal {
    const delta = clamp(deltaMs, 0, 90);
    const toneAlpha = 1 - Math.exp(-delta / 115);
    const pulseAlpha = 1 - Math.exp(-delta / 72);
    const target = {
      rms: clamp(features.rms * 1.35),
      bass: clamp(features.bass * 1.18),
      mid: clamp(features.mid * 1.22),
      treble: clamp(features.treble * 1.28),
      centroid: clamp(features.centroid),
      pulse: clamp(features.beatPulse * 1.4),
      energy: clamp(features.energy * 1.24),
      flux: clamp(features.spectralFlux * 1.45),
      flatness: clamp(features.spectralFlatness),
      rolloff: clamp(features.spectralRolloff),
      dynamics: clamp(features.dynamicRange * 1.16),
      onset: clamp(features.onsetPulse * 1.35),
      bassPulse: clamp(features.bassPulse * 1.32),
      midPulse: clamp(features.midPulse * 1.22),
      treblePulse: clamp(features.treblePulse * 1.2)
    };

    this.signal.rms = lerp(this.signal.rms, target.rms, toneAlpha);
    this.signal.bass = lerp(this.signal.bass, target.bass, toneAlpha);
    this.signal.mid = lerp(this.signal.mid, target.mid, toneAlpha);
    this.signal.treble = lerp(this.signal.treble, target.treble, toneAlpha);
    this.signal.centroid = lerp(this.signal.centroid, target.centroid, toneAlpha);
    this.signal.pulse = lerp(this.signal.pulse, target.pulse, pulseAlpha);
    this.signal.energy = lerp(this.signal.energy, target.energy, toneAlpha);
    this.signal.flux = lerp(this.signal.flux, target.flux, pulseAlpha);
    this.signal.flatness = lerp(this.signal.flatness, target.flatness, toneAlpha);
    this.signal.rolloff = lerp(this.signal.rolloff, target.rolloff, toneAlpha);
    this.signal.dynamics = lerp(this.signal.dynamics, target.dynamics, toneAlpha);
    this.signal.onset = lerp(this.signal.onset, target.onset, pulseAlpha);
    this.signal.bassPulse = lerp(this.signal.bassPulse, target.bassPulse, pulseAlpha);
    this.signal.midPulse = lerp(this.signal.midPulse, target.midPulse, pulseAlpha);
    this.signal.treblePulse = lerp(this.signal.treblePulse, target.treblePulse, pulseAlpha);

    return this.signal;
  }

  protected abstract build(): void;
  abstract update(features: AudioFeatures, deltaMs: number): void;
}

abstract class ShaderStagePreset extends PresetBase {
  protected stage?: THREE.Mesh;
  protected material?: THREE.ShaderMaterial;
  protected evolutionSeed = 0.41;
  private evolution?: OrganicEvolution;
  private time = 0;

  protected buildShaderStage(fragmentShader: string): void {
    this.evolution = new OrganicEvolution(this.evolutionSeed);
    this.material = new THREE.ShaderMaterial({
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      fragmentShader,
      toneMapped: false,
      transparent: true,
      uniforms: createCommonUniforms(this.palette),
      vertexShader: fullScreenVertexShader
    });
    this.stage = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.stage.renderOrder = -10;
    this.group.add(this.stage);
    this.resize(this.size);
  }

  resize(size: Size): void {
    super.resize(size);
    if (!this.stage) {
      return;
    }

    const aspect = size.width / Math.max(1, size.height);
    this.stage.scale.set(24 * Math.max(1, aspect), 24, 1);
    this.stage.position.set(0, 0, -0.4);
    if (this.material) {
      this.material.uniforms.uAspect.value = aspect;
    }
  }

  protected updateShader(features: AudioFeatures, deltaMs: number): VisualSignal {
    const signal = this.readSignal(features, deltaMs);
    this.time += deltaMs * 0.001;
    if (this.material) {
      const evolution = this.evolution?.update(signal, deltaMs) ?? initialEvolutionFrame;
      updateCommonUniforms(this.material, signal, evolution, this.time);
    }
    return signal;
  }
}

interface EvolutionFrame {
  seed: number;
  morph: number;
  drift: THREE.Vector2;
  event: number;
  flow: number;
  variant: number;
}

const initialEvolutionFrame: EvolutionFrame = {
  seed: 0,
  morph: 0,
  drift: new THREE.Vector2(0, 0),
  event: 0,
  flow: 0,
  variant: 0
};

class OrganicEvolution {
  private readonly random: () => number;
  private drift = new THREE.Vector2(0, 0);
  private targetDrift = new THREE.Vector2(0, 0);
  private event = 0;
  private flow = 0;
  private morphPhase = 0;
  private variant = 0;
  private elapsedMs = 0;
  private nextChangeMs = 1_800;
  private cooldownMs = 0;

  constructor(private readonly seed: number) {
    this.random = seededRandom(Math.round(seed * 100_000) + 73);
    this.variant = this.random();
    this.pickTarget();
  }

  update(signal: VisualSignal, deltaMs: number): EvolutionFrame {
    const delta = clamp(deltaMs, 0, 90);
    this.elapsedMs += delta;
    this.cooldownMs = Math.max(0, this.cooldownMs - delta);

    if (this.elapsedMs >= this.nextChangeMs || (signal.onset > 0.42 && this.cooldownMs === 0)) {
      this.pickTarget();
      this.variant = this.random();
      this.event = Math.max(this.event, 0.72 + signal.onset * 0.28);
      this.cooldownMs = 820 + this.random() * 920;
      this.nextChangeMs = this.elapsedMs + 2_600 + this.random() * 5_400;
    }

    const driftAlpha = 1 - Math.exp(-delta / (1_350 - signal.energy * 520));
    this.drift.lerp(this.targetDrift, clamp(driftAlpha, 0.01, 0.12));
    this.event *= Math.exp(-delta / 620);
    this.flow += delta * 0.001 * (0.09 + signal.energy * 0.24 + signal.flux * 0.18 + this.event * 0.08);
    this.morphPhase += delta * 0.001 * (0.05 + signal.flatness * 0.08 + signal.rolloff * 0.04);

    const morph =
      0.5 +
      Math.sin(this.morphPhase + this.seed * 8.0) * 0.28 +
      Math.sin(this.flow * 0.37 + this.variant * 6.283) * 0.18 +
      this.event * 0.18;

    return {
      seed: this.seed,
      morph: clamp(morph),
      drift: this.drift,
      event: clamp(this.event),
      flow: this.flow,
      variant: this.variant
    };
  }

  private pickTarget(): void {
    const angle = this.random() * Math.PI * 2;
    const radius = 0.08 + this.random() * 0.34;
    this.targetDrift.set(Math.cos(angle) * radius, Math.sin(angle) * radius * 0.72);
  }
}

class VortexEyePreset extends ShaderStagePreset {
  id = 'vortex-eye' as const;
  name = 'Vortex Eye';
  protected evolutionSeed = 0.13;

  protected build(): void {
    this.buildShaderStage(vortexEyeFragmentShader);
  }

  update(features: AudioFeatures, deltaMs: number): void {
    const signal = this.updateShader(features, deltaMs);
    this.group.scale.setScalar(1 + signal.onset * 0.02 + signal.bassPulse * 0.018);
  }
}

class ElectricFoldPreset extends ShaderStagePreset {
  id = 'electric-fold' as const;
  name = 'Electric Fold';
  protected evolutionSeed = 0.51;

  protected build(): void {
    this.buildShaderStage(electricFoldFragmentShader);
  }

  update(features: AudioFeatures, deltaMs: number): void {
    const signal = this.updateShader(features, deltaMs);
    this.group.rotation.z = Math.sin((this.material?.uniforms.uTime.value ?? 0) * 0.12) * (0.025 + signal.flatness * 0.018);
  }
}

class LiquidVeilPreset extends ShaderStagePreset {
  id = 'liquid-veil' as const;
  name = 'Liquid Veil';
  protected evolutionSeed = 0.77;

  protected build(): void {
    this.buildShaderStage(liquidVeilFragmentShader);
  }

  update(features: AudioFeatures, deltaMs: number): void {
    const signal = this.updateShader(features, deltaMs);
    const time = this.material?.uniforms.uTime.value ?? 0;
    this.group.rotation.z = Math.sin(time * 0.045) * (0.018 + signal.flatness * 0.02);
    this.group.scale.setScalar(1 + signal.onset * 0.018 + signal.midPulse * 0.012);
  }
}

class PlasmaBowlPreset extends ShaderStagePreset {
  id = 'plasma-bowl' as const;
  name = 'Plasma Bowl';
  protected evolutionSeed = 0.92;
  private sparks?: THREE.Points;
  private sparkBase = new Float32Array(0);
  private sparkSeeds = new Float32Array(0);
  private sparkPositions?: Float32Array;

  protected build(): void {
    this.buildShaderStage(plasmaBowlFragmentShader);

    const count = 900;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const base = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const random = seededRandom(9097);
    const fire = new THREE.Color('#ff3b18');
    const gold = new THREE.Color('#fff04f');
    const blue = new THREE.Color('#132cff');

    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      const seed = random();
      const angle = random() * Math.PI * 2;
      const radius = Math.pow(random(), 0.62) * 4.7;
      const height = -3.1 + Math.pow(random(), 1.7) * 4.3;
      const color = fire.clone().lerp(gold, random() * 0.72).lerp(blue, seed < 0.16 ? 0.65 : 0.04);

      base[offset] = Math.cos(angle) * radius;
      base[offset + 1] = height;
      base[offset + 2] = Math.sin(angle) * radius * 0.16;
      positions[offset] = base[offset];
      positions[offset + 1] = base[offset + 1];
      positions[offset + 2] = base[offset + 2];
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;
      seeds[index] = seed;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.34,
      size: 0.038,
      transparent: true,
      vertexColors: true
    });
    this.sparkBase = base;
    this.sparkPositions = positions;
    this.sparkSeeds = seeds;
    this.sparks = new THREE.Points(geometry, material);
    this.group.add(this.sparks);
  }

  update(features: AudioFeatures, deltaMs: number): void {
    const signal = this.updateShader(features, deltaMs);
    const time = this.material?.uniforms.uTime.value ?? 0;

    if (this.sparks && this.sparkPositions) {
      for (let index = 0; index < this.sparkPositions.length; index += 3) {
        const seed = this.sparkSeeds[index / 3];
        const baseX = this.sparkBase[index];
        const baseY = this.sparkBase[index + 1];
        const baseZ = this.sparkBase[index + 2];
        const lift = positiveModulo(baseY + 3.1 + time * (0.42 + seed * 0.86 + signal.energy * 0.9), 4.5);
        const swirl = Math.atan2(baseZ, baseX) + time * (0.18 + seed * 0.42) + signal.flux * 0.24;
        const radius = Math.hypot(baseX, baseZ) * (0.86 + signal.bass * 0.16 + signal.bassPulse * 0.08);

        this.sparkPositions[index] = Math.cos(swirl) * radius;
        this.sparkPositions[index + 1] = -3.1 + lift + Math.sin(time * 3 + seed * 9) * (0.05 + signal.treble * 0.18);
        this.sparkPositions[index + 2] = Math.sin(swirl) * radius * 0.18 - 0.2;
      }
      this.sparks.geometry.attributes.position.needsUpdate = true;
      const material = this.sparks.material as THREE.PointsMaterial;
      material.opacity = 0.12 + signal.energy * 0.26 + signal.bassPulse * 0.18 + signal.onset * 0.2;
      material.size = 0.026 + signal.treble * 0.018 + signal.treblePulse * 0.026;
    }

    this.group.scale.setScalar(1 + signal.onset * 0.025 + signal.bassPulse * 0.02);
  }
}

const fullScreenVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const shaderPrelude = `
  precision highp float;

  varying vec2 vUv;

  uniform float uTime;
  uniform float uAspect;
  uniform float uEnergy;
  uniform float uBass;
  uniform float uMid;
  uniform float uTreble;
  uniform float uCentroid;
  uniform float uFlux;
  uniform float uFlatness;
  uniform float uRolloff;
  uniform float uDynamics;
  uniform float uOnset;
  uniform float uBassPulse;
  uniform float uMidPulse;
  uniform float uTreblePulse;
  uniform float uSeed;
  uniform float uMorph;
  uniform float uEvent;
  uniform float uFlow;
  uniform float uVariant;
  uniform vec2 uDrift;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform vec3 uColorD;
  uniform vec3 uSoft;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i += 1) {
      value += noise(p) * amp;
      p = mat2(1.62, 1.21, -1.21, 1.62) * p + 7.3;
      amp *= 0.5;
    }
    return value;
  }

  float lineGlow(float distanceToLine, float width) {
    return exp(-abs(distanceToLine) / max(0.0001, width));
  }

  vec4 luminous(vec3 color, float gain) {
    vec3 toned = clamp(color, vec3(0.0), vec3(0.92));
    float alpha = clamp(max(max(toned.r, toned.g), toned.b) * gain, 0.0, 0.88);
    return vec4(toned, alpha);
  }
`;

const vortexEyeFragmentShader = `
  ${shaderPrelude}

  void main() {
    vec2 p = vUv - 0.5 - uDrift * 0.42;
    p.x *= uAspect;
    float r = length(p);
    float a = atan(p.y, p.x);
    float pulse = uOnset * 0.8 + uBassPulse * 0.55 + uEnergy * 0.35;
    float direction = mix(-1.0, 1.0, step(0.5, uVariant));
    float aperture = 0.72 + uMorph * 0.34 + pulse * 0.16;
    float twist = a * direction + (1.18 + uMorph * 0.92) / (r + 0.055) + uFlow * (2.2 + uFlux * 2.8) + sin(r * (7.0 + uMorph * 5.0) - uTime + uSeed * 9.0) * (0.15 + uEvent * 0.24);
    float cloudy = fbm(vec2(cos(twist), sin(twist)) * (2.0 + uFlatness * 3.5 + uMorph * 1.2) + r * (7.0 + uMorph * 6.0) - uFlow * 2.1 + uSeed);
    float rings = 0.5 + 0.5 * sin(r * (34.0 + uMorph * 42.0 + uRolloff * 18.0 + uEvent * 18.0) - uFlow * (16.0 + uBass * 12.0) + cloudy * (3.2 + uEvent * 2.0));
    float spokes = pow(0.5 + 0.5 * sin(twist * (7.0 + uCentroid * 14.0 + uMorph * 8.0) + r * (5.0 + uEvent * 8.0) + uFlow * 5.2), 3.0 + uMorph * 2.4);
    float mask = smoothstep(0.92, 0.08, r);
    float iris = mask * (pow(rings, 5.0) * 0.68 + pow(spokes, 2.6) * 0.34 + cloudy * 0.1);
    float halo = exp(-abs(r - (0.26 + aperture * 0.15 + pulse * 0.06)) * (7.0 - uEnergy * 1.9));
    float core = smoothstep(0.16 + aperture * 0.08 + pulse * 0.05, 0.045, r);
    float scan = lineGlow(p.y + sin(p.x * (3.4 + uMorph * 4.0) + uFlow * 4.0) * (0.012 + uEvent * 0.035), 0.008 + uTreblePulse * 0.016);

    vec3 cold = mix(vec3(0.02, 0.18, 0.75), vec3(0.22, 1.0, 0.9), 0.45 + uCentroid * 0.25);
    vec3 glow = mix(vec3(0.12, 0.82, 1.0), vec3(1.0, 0.98, 0.86), clamp(halo + spokes * 0.4, 0.0, 1.0));
    vec3 color = cold * iris * (0.7 + uEnergy * 0.6);
    color += glow * pow(halo, 2.2) * (1.15 + uEnergy * 0.8);
    color += vec3(0.95, 0.06, 1.0) * pow(spokes * rings, 2.0) * 0.18;
    color += vec3(0.72, 1.0, 0.98) * scan * (0.22 + uTreble * 0.36);
    color *= 1.0 - core * 0.92;
    color += vec3(0.78, 1.0, 1.0) * exp(-r * 34.0) * (0.25 + pulse * 0.65);
    color *= smoothstep(1.18, 0.28, r);
    color = max(color - vec3(0.018), vec3(0.0));
    color = pow(max(color, vec3(0.0)), vec3(0.82));

    gl_FragColor = luminous(color, 1.25);
  }
`;

const electricFoldFragmentShader = `
  ${shaderPrelude}

  void main() {
    vec2 p = vUv - 0.5 - uDrift * vec2(0.36, 0.24);
    p.x *= uAspect;
    float fold = abs(p.y);
    float n = fbm(vec2(p.x * (3.0 + uMorph * 3.8) + uFlow * 2.6, fold * (10.0 + uMorph * 10.0) - uFlow * 1.2 + uVariant * 5.0));
    float jag = (noise(vec2(p.x * 58.0 + uTime * 2.4, fold * 8.0)) - 0.5) * (0.11 + uFlatness * 0.19);
    float contour = 0.09 + sin(p.x * (3.4 + uRolloff * 3.0 + uMorph * 3.2) + uFlow * 6.0 + n * (4.0 + uEvent * 5.0)) * (0.11 + uMid * 0.22 + uEvent * 0.08);
    float jaw = pow(lineGlow(fold - contour - jag, 0.012 + uOnset * 0.018), 2.7);
    float echo = pow(lineGlow(fold - contour * 1.55 + jag * 0.4, 0.018 + uEnergy * 0.018), 3.2);
    float center = pow(lineGlow(p.y + sin(p.x * (7.0 + uMorph * 9.0) + uFlow * 8.0) * (0.022 + uFlux * 0.05 + uEvent * 0.03), 0.008 + uTreblePulse * 0.014), 2.25);
    float forkSource = sin((p.x + n * 0.28) * (18.0 + uMorph * 32.0) + uFlow * 12.0 + uVariant * 8.0);
    float forks = pow(lineGlow(abs(p.y) - abs(forkSource) * (0.12 + uEvent * 0.1) - 0.08, 0.01 + uFlatness * 0.012), 2.2);
    float smoke = smoothstep(0.48, 0.02, fold) * fbm(p * vec2(3.0 + uMorph * 3.0, 5.0) + vec2(uFlow * 0.8, -uFlow * 1.1));
    float flash = lineGlow(length(vec2(p.x * 0.45, p.y)) - (0.08 + uOnset * 0.08), 0.025 + uFlux * 0.02);

    vec3 violet = vec3(0.82, 0.16, 1.0);
    vec3 cyan = vec3(0.34, 1.0, 0.94);
    vec3 white = vec3(1.0, 0.94, 1.0);
    vec3 color = violet * pow(smoke, 8.0) * (0.025 + uEnergy * 0.08);
    color += mix(violet, white, jaw) * jaw * (2.4 + uTreble * 0.7);
    color += cyan * center * (1.15 + uTreblePulse * 1.35);
    color += mix(cyan, violet, uMorph) * forks * (0.42 + uEvent * 0.78 + uFlux * 0.28);
    color += vec3(0.9, 0.06, 1.0) * echo * (0.52 + uMidPulse * 0.62);
    color += white * pow(flash, 4.0) * (0.06 + uOnset * 0.14);
    color *= smoothstep(1.18, 0.24, length(p));
    color = max(color - vec3(0.032), vec3(0.0));
    color = pow(color, vec3(0.78));

    gl_FragColor = luminous(color, 1.35);
  }
`;

const liquidVeilFragmentShader = `
  ${shaderPrelude}

  void main() {
    vec2 uv = vUv;
    vec2 p = uv - 0.5 - uDrift * vec2(0.28, 0.18);
    p.x *= uAspect;
    float r = length(p);
    float angle = atan(p.y, p.x);
    float warpA = fbm(p * (2.1 + uMorph * 2.8) + vec2(uFlow * 0.58, -uFlow * 0.42 + uSeed * 4.0));
    float warpB = fbm(vec2(angle * 1.7, r * (5.0 + uMorph * 5.0)) + vec2(uFlow * 0.34, uVariant * 5.0));
    float foldA = p.y - sin(p.x * (3.4 + uMorph * 4.8) + warpA * 5.0 + uFlow * 2.8) * (0.16 + uMid * 0.22 + uEvent * 0.08);
    float foldB = p.y + sin(p.x * (5.2 + uVariant * 5.0) - warpB * 5.6 - uFlow * 2.2) * (0.12 + uTreble * 0.2);
    float veilA = lineGlow(foldA, 0.032 + uEnergy * 0.026 + uEvent * 0.022);
    float veilB = lineGlow(foldB + 0.18 * sin(angle * 2.0 + uFlow), 0.046 + uFlatness * 0.034);
    float sheetMask = smoothstep(0.92, 0.08, r + sin(angle * 3.0 + uFlow) * 0.08);
    float sheet = pow(sheetMask * (0.12 + warpA * 0.32 + warpB * 0.18), 1.75);
    float centerGlow = exp(-length(p - vec2(0.12 * sin(uFlow), -0.06 + uEvent * 0.08)) * (4.2 - uEvent * 0.65));
    float edgeSparkle = pow(noise(p * 42.0 + uFlow * 3.0), 9.0) * (veilA + veilB) * (0.2 + uTreblePulse);

    vec3 cyan = vec3(0.18, 1.0, 0.9);
    vec3 violet = vec3(0.72, 0.16, 1.0);
    vec3 white = vec3(0.95, 1.0, 0.95);
    vec3 color = cyan * veilA * (0.55 + uEnergy * 0.45);
    color += violet * veilB * (0.42 + uMorph * 0.35);
    color += mix(cyan, violet, warpB) * sheet * (0.18 + uMidPulse * 0.18);
    color += white * pow(centerGlow, 3.2) * (0.06 + uOnset * 0.16);
    color += mix(white, violet, uVariant) * edgeSparkle;
    color *= smoothstep(1.1, 0.22, r);
    color = max(color - vec3(0.045), vec3(0.0));

    gl_FragColor = luminous(pow(color, vec3(0.78)), 1.25);
  }
`;

const plasmaBowlFragmentShader = `
  ${shaderPrelude}

  void main() {
    vec2 p = vUv - 0.5 - uDrift * vec2(0.36, 0.18);
    p.x *= uAspect;
    float r = length(p);
    float a = atan(p.y, p.x);
    float base = smoothstep(0.52, 0.08, abs(p.y + 0.39 + uDrift.y * 0.18) + abs(p.x) * (0.22 + uMorph * 0.16));
    float bowl = lineGlow(length(vec2(p.x * (0.68 + uMorph * 0.26), p.y + 0.43)) - (0.33 + uBassPulse * 0.05 + uEvent * 0.04), 0.032 + uEnergy * 0.025);
    float flameNoise = fbm(vec2(p.x * (3.8 + uMorph * 4.0) + sin(a * (2.0 + uVariant * 5.0)), (p.y + 0.5) * (4.5 + uMorph * 3.0) - uFlow * (6.0 + uEnergy * 3.0)));
    float tongueSplit = sin(a * (8.0 + uMorph * 12.0) + uFlow * 8.0 + flameNoise * 4.0);
    float flame = smoothstep(0.5, 0.035, abs(p.x + tongueSplit * (0.04 + uEvent * 0.06)) + max(p.y + 0.28, 0.0) * (0.62 + uMorph * 0.36)) * flameNoise;
    flame *= smoothstep(-0.12, 0.42, p.y + 0.54);
    float sparks = pow(noise(vec2(a * (8.0 + uMorph * 7.0) + uFlow * 7.0, r * 17.0 - uFlow * 9.0)), 7.0) * smoothstep(0.72, 0.04, r);
    float hotCore = exp(-length(vec2(p.x * (1.05 + uMorph * 0.5), p.y + 0.38)) * (4.7 - uOnset * 0.9 - uEvent * 0.4));
    float blueLip = lineGlow(p.y + 0.44 + sin(p.x * (8.0 + uMorph * 6.0) + uFlow * 4.0) * (0.02 + uEvent * 0.035), 0.032 + uBassPulse * 0.025);

    vec3 red = vec3(1.0, 0.1, 0.02);
    vec3 gold = vec3(1.0, 0.92, 0.15);
    vec3 blue = vec3(0.06, 0.1, 1.0);
    vec3 color = vec3(0.01, 0.0, 0.0);
    color += red * flame * (0.95 + uEnergy * 0.7);
    color += gold * pow(flame, 2.3) * (1.1 + uOnset * 0.6);
    color += blue * blueLip * (0.42 + uBassPulse * 0.7);
    color += mix(red, gold, sparks) * sparks * (0.8 + uTreblePulse * 1.2);
    color += gold * bowl * (0.32 + uBassPulse * 0.54);
    color += mix(red, gold, hotCore) * hotCore * base * (0.28 + uEnergy * 0.28);
    color *= smoothstep(1.08, 0.18, r);
    color = max(color - vec3(0.035), vec3(0.0));
    color = pow(color, vec3(0.72));

    gl_FragColor = luminous(color, 1.1);
  }
`;

interface CommonUniforms extends Record<string, THREE.IUniform> {
  uTime: { value: number };
  uAspect: { value: number };
  uEnergy: { value: number };
  uBass: { value: number };
  uMid: { value: number };
  uTreble: { value: number };
  uCentroid: { value: number };
  uFlux: { value: number };
  uFlatness: { value: number };
  uRolloff: { value: number };
  uDynamics: { value: number };
  uOnset: { value: number };
  uBassPulse: { value: number };
  uMidPulse: { value: number };
  uTreblePulse: { value: number };
  uSeed: { value: number };
  uMorph: { value: number };
  uDrift: { value: THREE.Vector2 };
  uEvent: { value: number };
  uFlow: { value: number };
  uVariant: { value: number };
  uColorA: { value: THREE.Color };
  uColorB: { value: THREE.Color };
  uColorC: { value: THREE.Color };
  uColorD: { value: THREE.Color };
  uSoft: { value: THREE.Color };
}

function createCommonUniforms(palette: Palette): CommonUniforms {
  return {
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uEnergy: { value: 0 },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uTreble: { value: 0 },
    uCentroid: { value: 0 },
    uFlux: { value: 0 },
    uFlatness: { value: 0 },
    uRolloff: { value: 0 },
    uDynamics: { value: 0 },
    uOnset: { value: 0 },
    uBassPulse: { value: 0 },
    uMidPulse: { value: 0 },
    uTreblePulse: { value: 0 },
    uSeed: { value: 0 },
    uMorph: { value: 0 },
    uDrift: { value: new THREE.Vector2(0, 0) },
    uEvent: { value: 0 },
    uFlow: { value: 0 },
    uVariant: { value: 0 },
    uColorA: { value: new THREE.Color(palette.primary) },
    uColorB: { value: new THREE.Color(palette.secondary) },
    uColorC: { value: new THREE.Color(palette.hot) },
    uColorD: { value: new THREE.Color(palette.glow) },
    uSoft: { value: new THREE.Color(palette.soft) }
  };
}

function updateCommonUniforms(material: THREE.ShaderMaterial, signal: VisualSignal, evolution: EvolutionFrame, time: number): void {
  material.uniforms.uTime.value = time;
  material.uniforms.uEnergy.value = signal.energy;
  material.uniforms.uBass.value = signal.bass;
  material.uniforms.uMid.value = signal.mid;
  material.uniforms.uTreble.value = signal.treble;
  material.uniforms.uCentroid.value = signal.centroid;
  material.uniforms.uFlux.value = signal.flux;
  material.uniforms.uFlatness.value = signal.flatness;
  material.uniforms.uRolloff.value = signal.rolloff;
  material.uniforms.uDynamics.value = signal.dynamics;
  material.uniforms.uOnset.value = signal.onset;
  material.uniforms.uBassPulse.value = signal.bassPulse;
  material.uniforms.uMidPulse.value = signal.midPulse;
  material.uniforms.uTreblePulse.value = signal.treblePulse;
  material.uniforms.uSeed.value = evolution.seed;
  material.uniforms.uMorph.value = evolution.morph;
  material.uniforms.uDrift.value.copy(evolution.drift);
  material.uniforms.uEvent.value = evolution.event;
  material.uniforms.uFlow.value = evolution.flow;
  material.uniforms.uVariant.value = evolution.variant;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * clamp(alpha);
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function seededRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
