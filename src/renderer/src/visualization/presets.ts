import * as THREE from 'three';
import type { AudioFeatures } from '../audio/types';
import type { Palette, PresetId, Size, VisualizerPreset } from './types';

export function createPreset(id: PresetId, palette: Palette): VisualizerPreset {
  if (id === 'electric-fold') {
    return new ElectricFoldPreset(palette);
  }

  if (id === 'neon-analyzer') {
    return new NeonAnalyzerPreset(palette);
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
      updateCommonUniforms(this.material, signal, this.time);
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

  update(features: AudioFeatures, deltaMs: number): void {
    const signal = this.updateShader(features, deltaMs);
    this.group.scale.setScalar(1 + signal.onset * 0.02 + signal.bassPulse * 0.018);
  }
}

class ElectricFoldPreset extends ShaderStagePreset {
  id = 'electric-fold' as const;
  name = 'Electric Fold';

  protected build(): void {
    this.buildShaderStage(electricFoldFragmentShader);
  }

  update(features: AudioFeatures, deltaMs: number): void {
    const signal = this.updateShader(features, deltaMs);
    this.group.rotation.z = Math.sin((this.material?.uniforms.uTime.value ?? 0) * 0.12) * (0.025 + signal.flatness * 0.018);
  }
}

interface AnalyzerBar {
  bar: THREE.Mesh;
  cap: THREE.Mesh;
  index: number;
  baseColor: THREE.Color;
}

interface AnalyzerDune {
  mesh: THREE.Mesh;
  y: number;
  thickness: number;
  opacity: number;
  phase: number;
}

class NeonAnalyzerPreset extends ShaderStagePreset {
  id = 'neon-analyzer' as const;
  name = 'Neon Analyzer';
  private bars: AnalyzerBar[] = [];
  private dunes: AnalyzerDune[] = [];

  protected build(): void {
    this.buildShaderStage(neonAnalyzerFragmentShader);

    const count = 96;
    const barGeometry = new THREE.BoxGeometry(0.072, 1, 0.08);
    const capGeometry = new THREE.BoxGeometry(0.095, 0.055, 0.1);
    const low = new THREE.Color('#74ff00');
    const mid = new THREE.Color(this.palette.primary);
    const high = new THREE.Color('#fff35c');

    for (let index = 0; index < count; index += 1) {
      const progress = index / Math.max(1, count - 1);
      const color = progress < 0.55 ? low.clone().lerp(mid, progress / 0.55) : mid.clone().lerp(high, (progress - 0.55) / 0.45);
      const barMaterial = new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        color,
        depthWrite: false,
        opacity: 0.74,
        transparent: true
      });
      const capMaterial = new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        color: high.clone().lerp(color, 0.45),
        depthWrite: false,
        opacity: 0.62,
        transparent: true
      });
      const bar = new THREE.Mesh(barGeometry.clone(), barMaterial);
      const cap = new THREE.Mesh(capGeometry.clone(), capMaterial);
      this.bars.push({ bar, cap, index, baseColor: color });
      this.group.add(bar, cap);
    }

    const duneColors = [
      ['#1e5bff', '#161bff'],
      ['#ffb34d', '#2c5fff'],
      [this.palette.primary, this.palette.hot]
    ];
    for (let index = 0; index < duneColors.length; index += 1) {
      const geometry = createStripGeometry(220, false);
      fillStripColors(geometry, duneColors[index][0], duneColors[index][1]);
      const material = new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.28 - index * 0.045,
        side: THREE.DoubleSide,
        transparent: true,
        vertexColors: true
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.renderOrder = -1 + index;
      this.dunes.push({
        mesh,
        y: -0.25 + index * 0.38,
        thickness: 0.18 + index * 0.04,
        opacity: 0.28 - index * 0.045,
        phase: index * 0.19
      });
      this.group.add(mesh);
    }
  }

  update(features: AudioFeatures, deltaMs: number): void {
    const signal = this.updateShader(features, deltaMs);
    const time = this.material?.uniforms.uTime.value ?? 0;
    const span = this.size.width < 720 ? 10.0 : 12.2;
    const floor = -3.05;
    const hot = new THREE.Color('#fff35c');

    for (const entry of this.bars) {
      const progress = entry.index / Math.max(1, this.bars.length - 1);
      const band = sampleFrequency(features.bandEnvelopes, progress, 0.04);
      const peak = sampleFrequency(features.bandPeaks, progress, band);
      const bandPulse = progress < 0.22 ? signal.bassPulse : progress < 0.68 ? signal.midPulse : signal.treblePulse;
      const idleLilt = Math.sin(time * 1.8 + progress * Math.PI * 16) * 0.08;
      const height = clamp(0.18 + band * 4.9 + peak * 0.82 + bandPulse * 0.74 + signal.onset * 0.28 + idleLilt, 0.08, 5.7);
      const x = (progress - 0.5) * span;
      const z = -0.2 + Math.sin(progress * Math.PI * 5 + time * 0.6) * (0.035 + signal.flatness * 0.08);

      entry.bar.position.set(x, floor + height / 2, z);
      entry.bar.scale.set(1 + bandPulse * 0.18, height, 1 + peak * 0.36);
      entry.cap.position.set(x, floor + height + 0.08 + peak * 0.42, z + 0.045);
      entry.cap.scale.set(1 + peak * 0.7 + bandPulse * 0.18, 1, 1);

      const barMaterial = entry.bar.material as THREE.MeshBasicMaterial;
      const capMaterial = entry.cap.material as THREE.MeshBasicMaterial;
      barMaterial.color.copy(entry.baseColor).lerp(hot, peak * 0.35 + bandPulse * 0.18);
      barMaterial.opacity = 0.22 + band * 0.7 + peak * 0.34 + signal.energy * 0.18 + bandPulse * 0.18;
      capMaterial.opacity = 0.12 + peak * 0.42 + bandPulse * 0.28 + signal.onset * 0.18;
    }

    for (const dune of this.dunes) {
      const positions = dune.mesh.geometry.attributes.position.array as Float32Array;
      const pointCount = positions.length / 6;
      for (let point = 0; point < pointCount; point += 1) {
        const progress = point / Math.max(1, pointCount - 1);
        const offset = point * 6;
        const band = sampleFrequency(features.bandEnvelopes, progress, 0.04);
        const peak = sampleFrequency(features.bandPeaks, progress, band);
        const waveform = sampleWaveform(features.waveform, positiveModulo(progress + dune.phase, 1), 0);
        const x = (progress - 0.5) * span;
        const silhouette =
          dune.y +
          Math.pow(band, 0.72) * (1.15 + signal.energy * 0.8) +
          peak * 0.42 +
          waveform * (0.22 + signal.dynamics * 0.38) +
          Math.sin(progress * Math.PI * (5 + dune.phase * 8) + time * (0.9 + signal.flux)) * (0.05 + signal.flatness * 0.12);
        const thickness = dune.thickness * (1 + signal.onset * 0.45) + peak * 0.03;

        positions[offset] = x;
        positions[offset + 1] = silhouette + thickness;
        positions[offset + 2] = -0.48 - dune.phase;
        positions[offset + 3] = x;
        positions[offset + 4] = dune.y - thickness * 0.7;
        positions[offset + 5] = -0.55 - dune.phase;
      }
      dune.mesh.geometry.attributes.position.needsUpdate = true;
      const material = dune.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = dune.opacity * (0.58 + signal.energy * 0.85 + signal.flux * 0.5 + signal.onset * 0.5);
    }

    this.group.rotation.x = Math.sin(time * 0.05) * 0.025;
    this.group.rotation.y = Math.sin(time * 0.07) * 0.035 + signal.centroid * 0.02;
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
    vec2 p = vUv - 0.5;
    p.x *= uAspect;
    float r = length(p);
    float a = atan(p.y, p.x);
    float pulse = uOnset * 0.8 + uBassPulse * 0.55 + uEnergy * 0.35;
    float twist = a + 1.65 / (r + 0.065) + uTime * (0.24 + uFlux * 0.42) + sin(r * 8.0 - uTime) * 0.22;
    float cloudy = fbm(vec2(cos(twist), sin(twist)) * (2.2 + uFlatness * 3.2) + r * 8.0 - uTime * 0.38);
    float rings = 0.5 + 0.5 * sin(r * (48.0 + uRolloff * 22.0) - uTime * (2.4 + uBass * 3.0) + cloudy * 4.0);
    float spokes = pow(0.5 + 0.5 * sin(twist * (10.0 + uCentroid * 10.0) + r * 7.0 + uTime * 1.2), 4.0);
    float mask = smoothstep(0.92, 0.08, r);
    float iris = mask * (pow(rings, 5.0) * 0.68 + pow(spokes, 2.6) * 0.34 + cloudy * 0.1);
    float halo = exp(-abs(r - (0.32 + pulse * 0.08)) * (8.0 - uEnergy * 2.2));
    float core = smoothstep(0.21 + pulse * 0.04, 0.055, r);
    float scan = lineGlow(p.y + sin(p.x * 4.0 + uTime) * 0.018, 0.01 + uTreblePulse * 0.018);

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
    vec2 p = vUv - 0.5;
    p.x *= uAspect;
    float fold = abs(p.y);
    float n = fbm(vec2(p.x * 4.0 + uTime * 0.55, fold * 14.0 - uTime * 0.22));
    float jag = (noise(vec2(p.x * 58.0 + uTime * 2.4, fold * 8.0)) - 0.5) * (0.11 + uFlatness * 0.19);
    float contour = 0.12 + sin(p.x * (4.0 + uRolloff * 3.0) + uTime * 1.1 + n * 4.0) * (0.13 + uMid * 0.22);
    float jaw = pow(lineGlow(fold - contour - jag, 0.012 + uOnset * 0.018), 2.7);
    float echo = pow(lineGlow(fold - contour * 1.55 + jag * 0.4, 0.018 + uEnergy * 0.018), 3.2);
    float center = pow(lineGlow(p.y + sin(p.x * 10.0 + uTime * 1.4) * (0.025 + uFlux * 0.05), 0.009 + uTreblePulse * 0.015), 2.4);
    float smoke = smoothstep(0.48, 0.02, fold) * fbm(p * vec2(3.0, 5.0) + uTime * vec2(0.16, -0.26));
    float flash = lineGlow(length(vec2(p.x * 0.45, p.y)) - (0.08 + uOnset * 0.08), 0.025 + uFlux * 0.02);

    vec3 violet = vec3(0.82, 0.16, 1.0);
    vec3 cyan = vec3(0.34, 1.0, 0.94);
    vec3 white = vec3(1.0, 0.94, 1.0);
    vec3 color = violet * pow(smoke, 8.0) * (0.025 + uEnergy * 0.08);
    color += mix(violet, white, jaw) * jaw * (2.4 + uTreble * 0.7);
    color += cyan * center * (1.15 + uTreblePulse * 1.35);
    color += vec3(0.9, 0.06, 1.0) * echo * (0.52 + uMidPulse * 0.62);
    color += white * pow(flash, 4.0) * (0.06 + uOnset * 0.14);
    color *= smoothstep(1.18, 0.24, length(p));
    color = max(color - vec3(0.032), vec3(0.0));
    color = pow(color, vec3(0.78));

    gl_FragColor = luminous(color, 1.35);
  }
`;

const neonAnalyzerFragmentShader = `
  ${shaderPrelude}

  void main() {
    vec2 uv = vUv;
    vec2 p = uv - 0.5;
    p.x *= uAspect;
    float gridX = smoothstep(0.48, 0.5, abs(fract(uv.x * 36.0) - 0.5));
    float scan = lineGlow(p.y - sin(p.x * 4.0 + uTime * 0.6) * 0.03, 0.012);
    float block = step(0.72, noise(floor(vec2(uv.x * 22.0, uv.y * 12.0)) + floor(uTime * 1.8))) * smoothstep(0.18, 0.78, uv.y);
    float field = fbm(uv * vec2(3.0, 2.0) + vec2(uTime * 0.06, -uTime * 0.04));
    float dune = smoothstep(0.0, 0.018 + uEnergy * 0.02, (0.2 + field * 0.25 + uEnergy * 0.12) - uv.y);

    vec3 color = vec3(0.0);
    color += vec3(0.0, 0.08, 0.02) * gridX * 0.12;
    color += mix(vec3(0.02, 0.08, 0.55), vec3(0.95, 0.46, 0.14), uv.x) * dune * (0.16 + uEnergy * 0.22);
    color += vec3(0.2, 1.0, 0.12) * block * (0.05 + uFlux * 0.16);
    color += uColorA * scan * (0.18 + uTreblePulse * 0.22);
    color = max(color - vec3(0.012), vec3(0.0));

    gl_FragColor = luminous(color, 1.2);
  }
`;

const plasmaBowlFragmentShader = `
  ${shaderPrelude}

  void main() {
    vec2 p = vUv - 0.5;
    p.x *= uAspect;
    float r = length(p);
    float a = atan(p.y, p.x);
    float base = smoothstep(0.52, 0.08, abs(p.y + 0.39) + abs(p.x) * 0.28);
    float bowl = lineGlow(length(vec2(p.x * 0.82, p.y + 0.43)) - (0.36 + uBassPulse * 0.05), 0.035 + uEnergy * 0.025);
    float flameNoise = fbm(vec2(p.x * 4.8 + sin(a * 3.0), (p.y + 0.5) * 5.2 - uTime * (0.9 + uEnergy)));
    float flame = smoothstep(0.48, 0.04, abs(p.x) + max(p.y + 0.28, 0.0) * 0.72) * flameNoise;
    flame *= smoothstep(-0.12, 0.42, p.y + 0.54);
    float sparks = pow(noise(vec2(a * 9.0 + uTime * 1.7, r * 16.0 - uTime * 2.2)), 7.0) * smoothstep(0.68, 0.04, r);
    float hotCore = exp(-length(vec2(p.x * 1.25, p.y + 0.38)) * (5.2 - uOnset * 0.8));
    float blueLip = lineGlow(p.y + 0.44 + sin(p.x * 10.0 + uTime) * 0.025, 0.035 + uBassPulse * 0.025);

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
    uColorA: { value: new THREE.Color(palette.primary) },
    uColorB: { value: new THREE.Color(palette.secondary) },
    uColorC: { value: new THREE.Color(palette.hot) },
    uColorD: { value: new THREE.Color(palette.glow) },
    uSoft: { value: new THREE.Color(palette.soft) }
  };
}

function updateCommonUniforms(material: THREE.ShaderMaterial, signal: VisualSignal, time: number): void {
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
}

function createStripGeometry(pointCount: number, closed: boolean): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pointCount * 2 * 3), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pointCount * 2 * 3), 3));

  const indices: number[] = [];
  const segmentCount = closed ? pointCount : pointCount - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const next = (index + 1) % pointCount;
    const a = index * 2;
    const b = a + 1;
    const c = next * 2;
    const d = c + 1;
    indices.push(a, c, b, b, c, d);
  }

  geometry.setIndex(indices);
  return geometry;
}

function fillStripColors(geometry: THREE.BufferGeometry, start: string, end: string): void {
  const colors = geometry.attributes.color.array as Float32Array;
  const startColor = new THREE.Color(start);
  const endColor = new THREE.Color(end);
  const pointCount = colors.length / 6;

  for (let index = 0; index < pointCount; index += 1) {
    const progress = index / Math.max(1, pointCount - 1);
    const color = startColor.clone().lerp(endColor, progress);
    const offset = index * 6;
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
    colors[offset + 3] = color.r;
    colors[offset + 4] = color.g;
    colors[offset + 5] = color.b;
  }

  geometry.attributes.color.needsUpdate = true;
}

function sampleFrequency(bins: Float32Array, progress: number, fallback: number): number {
  if (bins.length === 0) {
    return fallback;
  }

  const index = clamp(Math.round(progress * (bins.length - 1)), 0, bins.length - 1);
  return bins[index] ?? fallback;
}

function sampleWaveform(waveform: Float32Array, progress: number, fallback: number): number {
  if (waveform.length === 0) {
    return fallback * 0.08;
  }

  const index = clamp(Math.round(progress * (waveform.length - 1)), 0, waveform.length - 1);
  return waveform[index] ?? fallback;
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
