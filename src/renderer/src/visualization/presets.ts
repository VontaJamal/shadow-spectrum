import * as THREE from 'three';
import type { AudioFeatures } from '../audio/types';
import { AUDIO_TEXTURE_HEIGHT, AUDIO_TEXTURE_HISTORY_ROWS } from './audioTexture';
import type {
  Palette,
  PresetCreateOptions,
  PresetId,
  Size,
  VisualFrameContext,
  VisualEvolutionFrame,
  VisualizerPreset
} from './types';
import { SeededPrng, deriveSeed } from './prng';

export function createPreset(id: PresetId, palette: Palette, options: Partial<PresetCreateOptions> = {}): VisualizerPreset {
  const createOptions: PresetCreateOptions = { seed: options.seed ?? 1 };
  if (id === 'electric-fold') {
    return new ElectricFoldPreset(palette, createOptions);
  }

  if (id === 'liquid-veil') {
    return new LiquidVeilPreset(palette, createOptions);
  }

  if (id === 'plasma-bowl') {
    return new PlasmaBowlPreset(palette, createOptions);
  }

  return new VortexEyePreset(palette, createOptions);
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

  constructor(
    protected palette: Palette,
    protected readonly options: PresetCreateOptions
  ) {}

  init(scene: THREE.Scene): void {
    scene.add(this.group);
    this.build();
  }

  resize(size: Size): void {
    this.size = size;
  }

  setPalette(palette: Palette): void {
    this.palette = palette;
    this.applyPalette(palette);
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
  protected applyPalette(_palette: Palette): void {}
  abstract update(context: VisualFrameContext): void;
}

abstract class ShaderStagePreset extends PresetBase {
  protected stage?: THREE.Mesh;
  protected material?: THREE.ShaderMaterial;
  private time = 0;

  protected buildShaderStage(fragmentShader: string): void {
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

  protected override applyPalette(palette: Palette): void {
    if (!this.material) {
      return;
    }
    this.material.uniforms.uColorA.value.set(palette.primary);
    this.material.uniforms.uColorB.value.set(palette.secondary);
    this.material.uniforms.uColorC.value.set(palette.hot);
    this.material.uniforms.uColorD.value.set(palette.glow);
    this.material.uniforms.uSoft.value.set(palette.soft);
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

  protected updateShader(context: VisualFrameContext): VisualSignal {
    const { deltaMs, features, evolution } = context;
    const signal = this.readSignal(features, deltaMs);
    this.time += deltaMs * 0.001;
    if (this.material) {
      updateCommonUniforms(this.material, signal, evolution, context, this.time);
    }
    return signal;
  }
}

class VortexEyePreset extends ShaderStagePreset {
  id = 'vortex-eye' as const;
  name = 'Vortex Eye';

  protected build(): void {
    this.buildShaderStage(vortexEyeFragmentShader);
  }

  update(context: VisualFrameContext): void {
    const signal = this.updateShader(context);
    this.group.scale.setScalar(1 + signal.onset * 0.02 + signal.bassPulse * 0.018);
  }
}

class ElectricFoldPreset extends ShaderStagePreset {
  id = 'electric-fold' as const;
  name = 'Electric Fold';

  protected build(): void {
    this.buildShaderStage(electricFoldFragmentShader);
  }

  update(context: VisualFrameContext): void {
    const signal = this.updateShader(context);
    this.group.rotation.z = context.evolution.dna.rotationDrift * (0.035 + signal.flatness * 0.018);
  }
}

class LiquidVeilPreset extends ShaderStagePreset {
  id = 'liquid-veil' as const;
  name = 'Liquid Veil';

  protected build(): void {
    this.buildShaderStage(liquidVeilFragmentShader);
  }

  update(context: VisualFrameContext): void {
    const signal = this.updateShader(context);
    this.group.rotation.z = context.evolution.dna.rotationDrift * (0.024 + signal.flatness * 0.02);
    this.group.scale.setScalar(1 + signal.onset * 0.018 + signal.midPulse * 0.012);
  }
}

class PlasmaBowlPreset extends ShaderStagePreset {
  id = 'plasma-bowl' as const;
  name = 'Plasma Bowl';
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
    const random = new SeededPrng(deriveSeed(this.options.seed, 'plasma-sparks'));
    const fire = new THREE.Color(this.palette.hot);
    const gold = new THREE.Color(this.palette.glow);
    const blue = new THREE.Color(this.palette.secondary);

    for (let index = 0; index < count; index += 1) {
      const offset = index * 3;
      const seed = random.next();
      const angle = random.next() * Math.PI * 2;
      const radius = Math.pow(random.next(), 0.62) * 4.7;
      const height = -3.1 + Math.pow(random.next(), 1.7) * 4.3;
      const color = fire.clone().lerp(gold, random.next() * 0.72).lerp(blue, seed < 0.16 ? 0.65 : 0.04);

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
      opacity: 0.24,
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

  protected override applyPalette(palette: Palette): void {
    super.applyPalette(palette);
    if (!this.sparks) {
      return;
    }

    const colorAttribute = this.sparks.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    if (!colorAttribute) {
      return;
    }

    const colors = colorAttribute.array as Float32Array;
    const fire = new THREE.Color(palette.hot);
    const gold = new THREE.Color(palette.glow);
    const blue = new THREE.Color(palette.secondary);
    for (let index = 0; index < this.sparkSeeds.length; index += 1) {
      const offset = index * 3;
      const seed = this.sparkSeeds[index];
      const color = fire.clone().lerp(gold, 0.28 + seed * 0.52).lerp(blue, seed < 0.16 ? 0.65 : 0.04);
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;
    }
    colorAttribute.needsUpdate = true;
  }

  update(context: VisualFrameContext): void {
    const signal = this.updateShader(context);
    const time = this.material?.uniforms.uTime.value ?? 0;
    const dna = context.evolution.dna;

    if (this.sparks && this.sparkPositions) {
      for (let index = 0; index < this.sparkPositions.length; index += 3) {
        const seed = this.sparkSeeds[index / 3];
        const baseX = this.sparkBase[index];
        const baseY = this.sparkBase[index + 1];
        const baseZ = this.sparkBase[index + 2];
        const lift = positiveModulo(baseY + 3.1 + time * (0.32 + seed * 0.72 + signal.energy * 0.82 + dna.flowSpeed * 0.28), 4.5);
        const swirl = Math.atan2(baseZ, baseX) + context.evolution.flow * (1.8 + seed * 1.2) + signal.flux * 0.24;
        const radius = Math.hypot(baseX, baseZ) * (0.86 + signal.bass * 0.16 + signal.bassPulse * 0.08);

        this.sparkPositions[index] = Math.cos(swirl) * radius;
        this.sparkPositions[index + 1] = -3.1 + lift + Math.sin(context.evolution.flow * 7 + seed * 9) * (0.05 + signal.treble * 0.18);
        this.sparkPositions[index + 2] = Math.sin(swirl) * radius * 0.18 - 0.2;
      }
      this.sparks.geometry.attributes.position.needsUpdate = true;
      const material = this.sparks.material as THREE.PointsMaterial;
      material.opacity = 0.08 + signal.energy * 0.2 + signal.bassPulse * 0.12 + signal.onset * 0.14;
      material.size = 0.022 + signal.treble * 0.014 + signal.treblePulse * 0.018;
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
  uniform float uOpacity;
  uniform float uMode;
  uniform float uCoordinateMode;
  uniform float uSymmetry;
  uniform float uMirror;
  uniform float uFlowSpeed;
  uniform float uTurbulence;
  uniform float uWarpScale;
  uniform float uWarpStrength;
  uniform float uNoiseOctaves;
  uniform float uZoom;
  uniform float uRotationDrift;
  uniform float uColorPhase;
  uniform float uPaletteMix;
  uniform float uBrightnessDistribution;
  uniform float uFieldDensity;
  uniform float uTopologyMix;
  uniform float uMacroEvent;
  uniform vec2 uDrift;
  uniform vec2 uComposition;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uColorC;
  uniform vec3 uColorD;
  uniform vec3 uSoft;
  uniform sampler2D uAudioTexture;
  uniform float uAudioRows;
  uniform float uAudioHistoryRows;

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

  float bandSample(float band, float row, float channel) {
    vec2 uv = vec2((clamp(band, 0.0, 23.0) + 0.5) / 24.0, (row + 0.5) / max(1.0, uAudioRows));
    vec4 value = texture2D(uAudioTexture, uv);
    if (channel < 0.5) {
      return value.r;
    }
    if (channel < 1.5) {
      return value.g;
    }
    if (channel < 2.5) {
      return value.b;
    }
    return value.a;
  }

  float spatialBand(vec2 p, float bias) {
    float angle = atan(p.y, p.x) / 6.2831853 + 0.5;
    float radius = clamp(length(p) * 1.25, 0.0, 1.0);
    float band = mix(radius, angle, bias) * 23.0;
    return bandSample(band, 0.0, 0.0);
  }

  vec2 evolveCoords(vec2 p) {
    vec2 q = (p - uComposition * 0.42) / max(0.35, uZoom);
    float r = length(q);
    float a = atan(q.y, q.x);
    float folded = abs(fract((a / 6.2831853) * max(1.0, uSymmetry)) - 0.5) * 2.0;
    float polarMix = smoothstep(0.7, 2.1, uCoordinateMode);
    vec2 polar = vec2(folded - 0.5, r - 0.35);
    q = mix(q, polar, polarMix * (0.35 + uMirror * 0.45));
    q += (fbm(q * (uWarpScale + 0.4) + uFlow * 0.31) - 0.5) * uWarpStrength * 0.22;
    return q;
  }

  float lineGlow(float distanceToLine, float width) {
    return exp(-abs(distanceToLine) / max(0.0001, width));
  }

  vec4 luminous(vec3 color, float gain) {
    vec3 toned = max(color - vec3(0.006), vec3(0.0));
    toned = clamp(toned, vec3(0.0), vec3(0.82));
    toned = pow(toned, vec3(0.9));
    float alpha = clamp(max(max(toned.r, toned.g), toned.b) * gain, 0.0, 0.72);
    return vec4(toned * (0.98 + uEnergy * 0.16) * uOpacity, alpha * uOpacity);
  }
`;

const vortexEyeFragmentShader = `
  ${shaderPrelude}

  void main() {
    vec2 p = vUv - 0.5 - uDrift * 0.42;
    p.x *= uAspect;
    p = evolveCoords(p);
    float r = length(p);
    float a = atan(p.y, p.x);
    float lowBand = bandSample(2.0 + r * 5.0, 0.0, 1.0);
    float midBand = spatialBand(p, 0.55);
    float highBand = bandSample(17.0 + fract(a / 6.2831853 + 0.5) * 6.0, 0.0, 3.0);
    float pulse = uOnset * 0.8 + uBassPulse * 0.55 + uEnergy * 0.35 + lowBand * 0.18;
    float direction = mix(-1.0, 1.0, step(0.5, fract(uMode * 0.37 + uFlowSpeed)));
    float aperture = 0.72 + uMorph * 0.34 + pulse * 0.16 + uTopologyMix * 0.12;
    float twist = a * direction + (1.18 + uMorph * 0.92 + lowBand * 0.35) / (r + 0.055) + uFlow * (2.2 + uFlux * 2.8 + uFlowSpeed) + sin(r * (7.0 + uFieldDensity * 12.0) - uTime + uSeed * 9.0) * (0.08 + uTurbulence * 0.12 + uEvent * 0.24);
    float cloudy = fbm(vec2(cos(twist), sin(twist)) * (2.0 + uFlatness * 3.5 + uWarpScale) + r * (7.0 + uFieldDensity * 9.0) - uFlow * 2.1 + uSeed);
    float rings = 0.5 + 0.5 * sin(r * (30.0 + uFieldDensity * 48.0 + uRolloff * 18.0 + uEvent * 18.0 + lowBand * 16.0) - uFlow * (16.0 + uBass * 12.0) + cloudy * (3.2 + uEvent * 2.0));
    float spokes = pow(0.5 + 0.5 * sin(twist * (5.0 + uSymmetry + uCentroid * 12.0 + midBand * 8.0) + r * (5.0 + uEvent * 8.0) + uFlow * 5.2), 2.5 + uBrightnessDistribution * 3.0);
    float mask = smoothstep(0.92, 0.08, r);
    float iris = mask * (pow(rings, 5.0) * 0.68 + pow(spokes, 2.6) * 0.34 + cloudy * 0.1);
    float halo = exp(-abs(r - (0.26 + aperture * 0.15 + pulse * 0.06)) * (7.0 - uEnergy * 1.9));
    float core = smoothstep(0.16 + aperture * 0.08 + pulse * 0.05, 0.045, r);
    float scan = lineGlow(p.y + sin(p.x * (3.4 + uFieldDensity * 7.0) + uFlow * 4.0) * (0.012 + uEvent * 0.035 + highBand * 0.02), 0.008 + uTreblePulse * 0.016);

    vec3 cold = mix(uColorB * 0.85, uColorA, 0.45 + uCentroid * 0.25 + uPaletteMix * 0.2);
    vec3 glow = mix(uColorD, uSoft, clamp(halo * 0.38 + spokes * 0.18 + uColorPhase * 0.08, 0.0, 0.62));
    vec3 color = cold * iris * (0.54 + uEnergy * 0.42);
    color += glow * pow(halo, 2.45) * (0.72 + uEnergy * 0.48);
    color += uColorC * pow(spokes * rings, 2.0) * (0.14 + midBand * 0.18);
    color += mix(uSoft, uColorA, 0.45) * scan * (0.12 + uTreble * 0.2 + highBand * 0.18);
    color *= 1.0 - core * 0.92;
    color += uColorD * exp(-r * 38.0) * (0.16 + pulse * 0.42);
    color *= smoothstep(1.18, 0.28, r);
    color = max(color - vec3(0.04), vec3(0.0));
    color = pow(max(color, vec3(0.0)), vec3(0.95));

    gl_FragColor = luminous(color, 0.98);
  }
`;

const electricFoldFragmentShader = `
  ${shaderPrelude}

  void main() {
    vec2 p = vUv - 0.5 - uDrift * vec2(0.36, 0.24);
    p.x *= uAspect;
    p = evolveCoords(p);
    float lowBand = bandSample(abs(p.y) * 8.0, 0.0, 1.0);
    float midBand = bandSample(abs(p.x) * 12.0 + 7.0, 0.0, 0.0);
    float highBand = bandSample(16.0 + abs(p.y) * 7.0, 0.0, 3.0);
    float diagonal = mix(abs(p.y), abs((p.x + p.y) * 0.707), smoothstep(1.0, 3.0, uMode));
    float radial = abs(length(p) - 0.18 - uTopologyMix * 0.22);
    float fold = mix(diagonal, radial, smoothstep(3.0, 4.0, uMode));
    float n = fbm(vec2(p.x * (3.0 + uFieldDensity * 5.8) + uFlow * (2.2 + uFlowSpeed), fold * (10.0 + uFieldDensity * 12.0) - uFlow * 1.2 + uVariant * 5.0));
    float jag = (noise(vec2(p.x * (42.0 + uFieldDensity * 48.0) + uFlow * 3.4, fold * 8.0)) - 0.5) * (0.08 + uFlatness * 0.19 + highBand * 0.08);
    float contour = 0.09 + sin(p.x * (3.4 + uRolloff * 3.0 + uFieldDensity * 5.2) + uFlow * 6.0 + n * (4.0 + uEvent * 5.0)) * (0.1 + uMid * 0.22 + midBand * 0.2 + uEvent * 0.08);
    float jaw = pow(lineGlow(fold - contour - jag, 0.012 + uOnset * 0.018), 2.7);
    float echo = pow(lineGlow(fold - contour * 1.55 + jag * 0.4, 0.018 + uEnergy * 0.018), 3.2);
    float center = pow(lineGlow(p.y + sin(p.x * (7.0 + uMorph * 9.0) + uFlow * 8.0) * (0.022 + uFlux * 0.05 + uEvent * 0.03), 0.008 + uTreblePulse * 0.014), 2.25);
    float forkSource = sin((p.x + n * 0.28) * (14.0 + uSymmetry * 4.0 + uFieldDensity * 28.0) + uFlow * 12.0 + uVariant * 8.0);
    float forks = pow(lineGlow(abs(p.y) - abs(forkSource) * (0.12 + uEvent * 0.1) - 0.08, 0.01 + uFlatness * 0.012), 2.2);
    float smoke = smoothstep(0.48, 0.02, fold) * fbm(p * vec2(3.0 + uWarpScale * 1.6, 5.0) + vec2(uFlow * 0.8, -uFlow * 1.1));
    float flash = lineGlow(length(vec2(p.x * 0.45, p.y)) - (0.08 + uOnset * 0.08), 0.025 + uFlux * 0.02);

    vec3 violet = mix(uColorB, uColorC, uPaletteMix * 0.45);
    vec3 cyan = mix(uColorA, uColorD, uColorPhase * 0.35);
    vec3 bright = mix(uSoft, cyan, 0.54);
    vec3 color = violet * pow(smoke, 8.0) * (0.025 + uEnergy * 0.08);
    color += mix(violet, bright, jaw * 0.7) * jaw * (1.75 + uTreble * 0.58);
    color += cyan * center * (0.98 + uTreblePulse * 1.05 + highBand * 0.44);
    color += mix(cyan, violet, uMorph) * forks * (0.42 + uEvent * 0.58 + uFlux * 0.24);
    color += uColorC * echo * (0.5 + uMidPulse * 0.52 + midBand * 0.24);
    color += bright * pow(flash, 4.2) * (0.05 + uOnset * 0.12);
    color *= smoothstep(1.18, 0.24, length(p));
    color = max(color - vec3(0.024), vec3(0.0));
    color = pow(color, vec3(0.84));

    gl_FragColor = luminous(color, 1.06);
  }
`;

const liquidVeilFragmentShader = `
  ${shaderPrelude}

  void main() {
    vec2 uv = vUv;
    vec2 p = uv - 0.5 - uDrift * vec2(0.28, 0.18);
    p.x *= uAspect;
    p = evolveCoords(p);
    float r = length(p);
    float angle = atan(p.y, p.x);
    float lowBand = bandSample(r * 7.0, 0.0, 1.0);
    float midBand = spatialBand(p, 0.35);
    float highBand = bandSample(17.0 + fract(angle / 6.2831853 + 0.5) * 6.0, 0.0, 3.0);
    float warpA = fbm(p * (2.1 + uWarpScale * 2.2) + vec2(uFlow * 0.58, -uFlow * 0.42 + uSeed * 4.0));
    float warpB = fbm(vec2(angle * (1.4 + uMirror * 2.2), r * (5.0 + uFieldDensity * 6.0)) + vec2(uFlow * 0.34, uVariant * 5.0));
    float ribbonAxis = mix(p.y, p.x * 0.4 + p.y * 0.8, smoothstep(2.0, 4.0, uMode));
    float foldA = ribbonAxis - sin(p.x * (3.4 + uFieldDensity * 5.8) + warpA * (4.0 + uWarpStrength * 3.0) + uFlow * 2.8) * (0.14 + uMid * 0.22 + midBand * 0.16 + uEvent * 0.08);
    float foldB = ribbonAxis + sin(p.x * (5.2 + uVariant * 5.0) - warpB * 5.6 - uFlow * 2.2) * (0.1 + uTreble * 0.2 + highBand * 0.08);
    float veilA = lineGlow(foldA, 0.032 + uEnergy * 0.026 + uEvent * 0.022);
    float veilB = lineGlow(foldB + 0.18 * sin(angle * 2.0 + uFlow), 0.046 + uFlatness * 0.034);
    float sheetMask = smoothstep(0.92, 0.08, r + sin(angle * (2.0 + uSymmetry * 0.2) + uFlow) * (0.06 + lowBand * 0.06));
    float sheet = pow(sheetMask * (0.12 + warpA * 0.32 + warpB * 0.18 + lowBand * 0.12), 1.55 + uBrightnessDistribution);
    float centerGlow = exp(-length(p - vec2(uDrift.x * 0.4, -0.06 + uEvent * 0.08 + uDrift.y * 0.3)) * (4.2 - uEvent * 0.65));
    float edgeSparkle = pow(noise(p * 42.0 + uFlow * 3.0), 9.0) * (veilA + veilB) * (0.2 + uTreblePulse);

    vec3 cyan = mix(uColorA, uColorD, uPaletteMix * 0.36);
    vec3 violet = mix(uColorB, uColorC, uColorPhase * 0.42);
    vec3 bright = mix(uSoft, cyan, 0.5);
    vec3 color = cyan * veilA * (0.38 + uEnergy * 0.3);
    color += violet * veilB * (0.32 + uMorph * 0.24);
    color += mix(cyan, violet, warpB) * sheet * (0.12 + uMidPulse * 0.12);
    color += bright * pow(centerGlow, 3.5) * (0.035 + uOnset * 0.1);
    color += mix(bright, violet, uVariant) * edgeSparkle * 0.62;
    color *= smoothstep(1.1, 0.22, r);
    color = max(color - vec3(0.062), vec3(0.0));

    gl_FragColor = luminous(pow(color, vec3(0.96)), 0.92);
  }
`;

const plasmaBowlFragmentShader = `
  ${shaderPrelude}

  void main() {
    vec2 p = vUv - 0.5 - uDrift * vec2(0.36, 0.18);
    p.x *= uAspect;
    p = evolveCoords(p);
    float r = length(p);
    float a = atan(p.y, p.x);
    float lowBand = bandSample(r * 8.0, 0.0, 1.0);
    float midBand = spatialBand(p, 0.5);
    float highBand = bandSample(16.0 + fract(a / 6.2831853 + 0.5) * 7.0, 0.0, 3.0);
    float gravity = mix(p.y, p.x * 0.45 + p.y * 0.75, smoothstep(2.0, 4.0, uMode));
    float base = smoothstep(0.52, 0.08, abs(gravity + 0.39 + uDrift.y * 0.18) + abs(p.x) * (0.22 + uTopologyMix * 0.16));
    float bowl = lineGlow(length(vec2(p.x * (0.68 + uTopologyMix * 0.26), gravity + 0.43)) - (0.33 + uBassPulse * 0.05 + lowBand * 0.05 + uEvent * 0.04), 0.032 + uEnergy * 0.025);
    float flameNoise = fbm(vec2(p.x * (3.8 + uWarpScale * 2.0) + sin(a * (2.0 + uVariant * 5.0)), (gravity + 0.5) * (4.5 + uFieldDensity * 4.0) - uFlow * (6.0 + uEnergy * 3.0)));
    float tongueSplit = sin(a * (6.0 + uSymmetry * 1.6) + uFlow * 8.0 + flameNoise * 4.0);
    float flame = smoothstep(0.5, 0.035, abs(p.x + tongueSplit * (0.04 + uEvent * 0.06 + midBand * 0.04)) + max(gravity + 0.28, 0.0) * (0.62 + uTopologyMix * 0.36)) * flameNoise;
    flame *= smoothstep(-0.12, 0.42, p.y + 0.54);
    float sparks = pow(noise(vec2(a * (8.0 + uFieldDensity * 8.0) + uFlow * 7.0, r * 17.0 - uFlow * 9.0)), 6.0 + highBand * 3.0) * smoothstep(0.72, 0.04, r);
    float hotCore = exp(-length(vec2(p.x * (1.05 + uTopologyMix * 0.5), gravity + 0.38)) * (4.7 - uOnset * 0.9 - uEvent * 0.4));
    float blueLip = lineGlow(gravity + 0.44 + sin(p.x * (8.0 + uFieldDensity * 7.0) + uFlow * 4.0) * (0.02 + uEvent * 0.035 + highBand * 0.02), 0.032 + uBassPulse * 0.025);

    vec3 red = mix(uColorC, uColorA, uPaletteMix * 0.24);
    vec3 gold = mix(uColorD, uSoft, uBrightnessDistribution * 0.16);
    vec3 blue = uColorB;
    vec3 color = vec3(0.01, 0.0, 0.0);
    color += red * flame * (0.68 + uEnergy * 0.46);
    color += gold * pow(flame, 2.4) * (0.72 + uOnset * 0.38);
    color += blue * blueLip * (0.28 + uBassPulse * 0.44);
    color += mix(red, gold, sparks) * sparks * (0.5 + uTreblePulse * 0.76 + highBand * 0.42);
    color += gold * bowl * (0.22 + uBassPulse * 0.34);
    color += mix(red, gold, hotCore) * hotCore * base * (0.18 + uEnergy * 0.2);
    color *= smoothstep(1.08, 0.18, r);
    color = max(color - vec3(0.052), vec3(0.0));
    color = pow(color, vec3(0.92));

    gl_FragColor = luminous(color, 0.9);
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
  uOpacity: { value: number };
  uMode: { value: number };
  uCoordinateMode: { value: number };
  uSymmetry: { value: number };
  uMirror: { value: number };
  uFlowSpeed: { value: number };
  uTurbulence: { value: number };
  uWarpScale: { value: number };
  uWarpStrength: { value: number };
  uNoiseOctaves: { value: number };
  uZoom: { value: number };
  uRotationDrift: { value: number };
  uColorPhase: { value: number };
  uPaletteMix: { value: number };
  uBrightnessDistribution: { value: number };
  uFieldDensity: { value: number };
  uTopologyMix: { value: number };
  uMacroEvent: { value: number };
  uColorA: { value: THREE.Color };
  uColorB: { value: THREE.Color };
  uColorC: { value: THREE.Color };
  uColorD: { value: THREE.Color };
  uSoft: { value: THREE.Color };
  uComposition: { value: THREE.Vector2 };
  uAudioTexture: { value: THREE.Texture | null };
  uAudioRows: { value: number };
  uAudioHistoryRows: { value: number };
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
    uOpacity: { value: 1 },
    uMode: { value: 0 },
    uCoordinateMode: { value: 0 },
    uSymmetry: { value: 4 },
    uMirror: { value: 0 },
    uFlowSpeed: { value: 0.3 },
    uTurbulence: { value: 0.2 },
    uWarpScale: { value: 1 },
    uWarpStrength: { value: 0.2 },
    uNoiseOctaves: { value: 4 },
    uZoom: { value: 1 },
    uRotationDrift: { value: 0 },
    uColorPhase: { value: 0 },
    uPaletteMix: { value: 0 },
    uBrightnessDistribution: { value: 0.5 },
    uFieldDensity: { value: 0.5 },
    uTopologyMix: { value: 0 },
    uMacroEvent: { value: 0 },
    uColorA: { value: new THREE.Color(palette.primary) },
    uColorB: { value: new THREE.Color(palette.secondary) },
    uColorC: { value: new THREE.Color(palette.hot) },
    uColorD: { value: new THREE.Color(palette.glow) },
    uSoft: { value: new THREE.Color(palette.soft) },
    uComposition: { value: new THREE.Vector2(0, 0) },
    uAudioTexture: { value: null },
    uAudioRows: { value: AUDIO_TEXTURE_HEIGHT },
    uAudioHistoryRows: { value: AUDIO_TEXTURE_HISTORY_ROWS }
  };
}

function updateCommonUniforms(
  material: THREE.ShaderMaterial,
  signal: VisualSignal,
  evolution: VisualEvolutionFrame,
  context: VisualFrameContext,
  time: number
): void {
  const { dna } = evolution;
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
  material.uniforms.uSeed.value = safeNumber(evolution.seed);
  material.uniforms.uMorph.value = safeNumber(dna.brightnessDistribution * 0.48 + dna.topologyMix * 0.32 + evolution.macroEvent * 0.2);
  material.uniforms.uDrift.value.set(safeNumber(dna.centerX), safeNumber(dna.centerY));
  material.uniforms.uEvent.value = evolution.event;
  material.uniforms.uFlow.value = evolution.flow;
  material.uniforms.uVariant.value = safeNumber((dna.internalMode + dna.coordinateSystem * 0.17 + dna.colorPhase) % 1);
  material.uniforms.uOpacity.value = safeNumber(context.opacity, 1);
  material.uniforms.uMode.value = safeNumber(dna.internalMode);
  material.uniforms.uCoordinateMode.value = safeNumber(dna.coordinateSystem);
  material.uniforms.uSymmetry.value = safeNumber(dna.symmetryCount, 4);
  material.uniforms.uMirror.value = safeNumber(dna.mirrorMix);
  material.uniforms.uFlowSpeed.value = safeNumber(dna.flowSpeed);
  material.uniforms.uTurbulence.value = safeNumber(dna.turbulence);
  material.uniforms.uWarpScale.value = safeNumber(dna.domainWarpScale, 1);
  material.uniforms.uWarpStrength.value = safeNumber(dna.domainWarpStrength);
  material.uniforms.uNoiseOctaves.value = safeNumber(dna.noiseOctaves, 4);
  material.uniforms.uZoom.value = safeNumber(dna.zoom, 1);
  material.uniforms.uRotationDrift.value = safeNumber(dna.rotationDrift);
  material.uniforms.uColorPhase.value = safeNumber(dna.colorPhase);
  material.uniforms.uPaletteMix.value = safeNumber(dna.paletteInterpolation);
  material.uniforms.uBrightnessDistribution.value = safeNumber(dna.brightnessDistribution);
  material.uniforms.uFieldDensity.value = safeNumber(dna.fieldDensity);
  material.uniforms.uTopologyMix.value = safeNumber(dna.topologyMix);
  material.uniforms.uMacroEvent.value = safeNumber(evolution.macroEvent);
  material.uniforms.uComposition.value.set(safeNumber(dna.compositionX), safeNumber(dna.compositionY));
  material.uniforms.uAudioTexture.value = context.spectrumTexture;
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

function safeNumber(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}
