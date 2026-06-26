import * as THREE from 'three';
import type { AudioFeatures } from '../audio/types';
import type { Palette, PresetId, Size, VisualizerPreset } from './types';

export function createPreset(id: PresetId, palette: Palette): VisualizerPreset {
  if (id === 'wireframe-cascade') {
    return new WireframeCascadePreset(palette);
  }

  if (id === 'chromatic-flow') {
    return new ChromaticFlowPreset(palette);
  }

  if (id === 'signal-scope') {
    return new SignalScopePreset(palette);
  }

  return new FeedbackTunnelPreset(palette);
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

interface TunnelRing {
  line: THREE.LineLoop;
  phase: number;
  twist: number;
  baseRadius: number;
  opacity: number;
}

class FeedbackTunnelPreset extends PresetBase {
  id = 'feedback-tunnel' as const;
  name = 'Feedback Tunnel';
  private rings: TunnelRing[] = [];
  private starfield?: THREE.Points;
  private starBase = new Float32Array(0);
  private starSeeds = new Float32Array(0);
  private starPositions?: Float32Array;
  private time = 0;

  protected build(): void {
    const ringCount = 58;
    const vertices = 104;
    const colors = [this.palette.primary, this.palette.secondary, this.palette.hot, this.palette.glow];

    for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
      const geometry = createLineGeometry(vertices);
      fillLineColors(geometry, colors[ringIndex % colors.length], colors[(ringIndex + 1) % colors.length]);
      const material = new THREE.LineBasicMaterial({
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.08 + (ringIndex / ringCount) * 0.14,
        transparent: true,
        vertexColors: true
      });
      const line = new THREE.LineLoop(geometry, material);
      this.rings.push({
        line,
        phase: ringIndex / ringCount,
        twist: ringIndex * 0.21,
        baseRadius: 0.72 + Math.sin(ringIndex * 0.37) * 0.08,
        opacity: 0.08 + (ringIndex / ringCount) * 0.14
      });
      this.group.add(line);
    }

    const starCount = 1_400;
    const positions = new Float32Array(starCount * 3);
    const colorsArray = new Float32Array(starCount * 3);
    const seeds = new Float32Array(starCount);
    const base = new Float32Array(starCount * 3);
    const random = seededRandom(3109);
    const primary = new THREE.Color(this.palette.primary);
    const secondary = new THREE.Color(this.palette.secondary);
    const hot = new THREE.Color(this.palette.hot);

    for (let index = 0; index < starCount; index += 1) {
      const offset = index * 3;
      const angle = random() * Math.PI * 2;
      const radius = 0.8 + Math.pow(random(), 0.38) * 5.6;
      const z = -7.2 + random() * 13.8;
      const seed = random();
      const color = primary.clone().lerp(secondary, random() * 0.68).lerp(hot, seed > 0.84 ? 0.45 : 0.06);

      base[offset] = Math.cos(angle) * radius;
      base[offset + 1] = Math.sin(angle) * radius * 0.68;
      base[offset + 2] = z;
      positions[offset] = base[offset];
      positions[offset + 1] = base[offset + 1];
      positions[offset + 2] = z;
      colorsArray[offset] = color.r;
      colorsArray[offset + 1] = color.g;
      colorsArray[offset + 2] = color.b;
      seeds[index] = seed;
    }

    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starGeometry.setAttribute('color', new THREE.BufferAttribute(colorsArray, 3));
    const starMaterial = new THREE.PointsMaterial({
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.32,
      size: 0.024,
      transparent: true,
      vertexColors: true
    });
    this.starBase = base;
    this.starPositions = positions;
    this.starSeeds = seeds;
    this.starfield = new THREE.Points(starGeometry, starMaterial);
    this.group.add(this.starfield);
  }

  update(features: AudioFeatures, deltaMs: number): void {
    const signal = this.readSignal(features, deltaMs);
    this.time += deltaMs * 0.001;
    const travel = this.time * (0.105 + signal.energy * 0.13 + signal.flux * 0.09) + signal.onset * 0.08;
    const globalTwist = this.time * (0.11 + signal.rolloff * 0.12) + signal.centroid * 0.48;

    for (const ring of this.rings) {
      const positions = ring.line.geometry.attributes.position.array as Float32Array;
      const vertices = positions.length / 3;
      const tunnelProgress = positiveModulo(ring.phase + travel, 1);
      const z = -7.4 + tunnelProgress * 12.8;
      const depthScale = 0.64 + tunnelProgress * 1.92;
      const detail = 3 + Math.floor(signal.flatness * 5);

      for (let vertex = 0; vertex < vertices; vertex += 1) {
        const progress = vertex / vertices;
        const offset = vertex * 3;
        const angle = progress * Math.PI * 2;
        const bandProgress = positiveModulo(progress + tunnelProgress * 0.45 + signal.centroid * 0.12, 1);
        const band = sampleFrequency(features.bandEnvelopes, bandProgress, 0.03);
        const peak = sampleFrequency(features.bandPeaks, bandProgress, band);
        const ripple =
          Math.sin(angle * detail + this.time * (2.0 + signal.flux * 1.7) + ring.twist) *
          (0.08 + signal.flatness * 0.18 + peak * 0.22);
        const beatWarp =
          Math.sin(angle * 2 - this.time * 3.2 + tunnelProgress * Math.PI * 5) *
          (signal.bassPulse * 0.22 + signal.onset * 0.18);
        const radius =
          ring.baseRadius * depthScale +
          band * (0.42 + signal.energy * 0.34) +
          peak * 0.28 +
          ripple +
          beatWarp;
        const twist = globalTwist + ring.twist + tunnelProgress * (1.8 + signal.rolloff * 1.2);

        positions[offset] = Math.cos(angle + twist) * radius * (1 + signal.bassPulse * 0.08);
        positions[offset + 1] = Math.sin(angle - twist * 0.42) * radius * (0.66 + signal.mid * 0.12);
        positions[offset + 2] = z + Math.sin(angle * 4 + this.time * 1.5) * (0.04 + signal.treble * 0.14);
      }

      ring.line.geometry.attributes.position.needsUpdate = true;
      const material = ring.line.material as THREE.LineBasicMaterial;
      const frontGlow = Math.pow(tunnelProgress, 1.7);
      material.opacity =
        ring.opacity * (0.45 + frontGlow * 1.35 + signal.energy * 0.55 + signal.onset * 0.75 + signal.flux * 0.32);
    }

    if (this.starfield && this.starPositions) {
      const speed = this.time * (0.62 + signal.energy * 1.8 + signal.onset * 1.1);
      for (let index = 0; index < this.starPositions.length; index += 3) {
        const seed = this.starSeeds[index / 3];
        const baseX = this.starBase[index];
        const baseY = this.starBase[index + 1];
        const baseZ = this.starBase[index + 2];
        const z = positiveModulo((baseZ + 7.2 + speed * (0.55 + seed * 1.8)) / 13.8, 1) * 13.8 - 7.2;
        const angle = Math.atan2(baseY, baseX) + globalTwist * (0.08 + seed * 0.12);
        const radius = Math.hypot(baseX, baseY) * (0.88 + signal.bass * 0.12 + signal.bassPulse * 0.06);

        this.starPositions[index] = Math.cos(angle) * radius;
        this.starPositions[index + 1] = Math.sin(angle) * radius * (0.72 + signal.mid * 0.08);
        this.starPositions[index + 2] = z;
      }

      this.starfield.geometry.attributes.position.needsUpdate = true;
      const material = this.starfield.material as THREE.PointsMaterial;
      material.opacity = 0.12 + signal.energy * 0.25 + signal.flux * 0.16 + signal.onset * 0.24;
      material.size = 0.016 + signal.treble * 0.018 + signal.treblePulse * 0.02;
    }

    this.group.rotation.x = Math.sin(this.time * 0.09) * (0.08 + signal.flatness * 0.08);
    this.group.rotation.y = Math.cos(this.time * 0.08) * 0.1 + signal.centroid * 0.08;
    this.group.scale.setScalar(1 + signal.bassPulse * 0.025 + signal.onset * 0.018);
  }
}

interface CascadeWire {
  line: THREE.Line;
  row: number;
  echo: number;
  phase: number;
  depth: number;
  opacity: number;
}

class WireframeCascadePreset extends PresetBase {
  id = 'wireframe-cascade' as const;
  name = 'Wireframe Cascade';
  private wires: CascadeWire[] = [];
  private time = 0;

  protected build(): void {
    const rows = 11;
    const echoes = 2;
    const columns = 188;
    const colors = [this.palette.glow, this.palette.primary, this.palette.secondary, this.palette.hot];

    for (let echo = 0; echo < echoes; echo += 1) {
      for (let row = 0; row < rows; row += 1) {
        const geometry = createLineGeometry(columns);
        fillLineColors(geometry, colors[(row + echo) % colors.length], colors[(row + echo + 1) % colors.length]);
        const material = new THREE.LineBasicMaterial({
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: echo === 0 ? 0.34 : 0.11,
          transparent: true,
          vertexColors: true
        });
        const line = new THREE.Line(geometry, material);
        this.wires.push({
          line,
          row,
          echo,
          phase: row * 0.53 + echo * 0.82,
          depth: -3.4 + row * 0.42 - echo * 0.75,
          opacity: echo === 0 ? 0.34 : 0.11
        });
        this.group.add(line);
      }
    }

    this.group.rotation.x = -0.34;
  }

  update(features: AudioFeatures, deltaMs: number): void {
    const signal = this.readSignal(features, deltaMs);
    this.time += deltaMs * 0.001;
    const span = this.size.width < 720 ? 10.4 : 12.8;
    const rowMidpoint = 5;
    const waveDepth = 0.24 + signal.mid * 0.9 + signal.midPulse * 0.65 + signal.dynamics * 0.34;

    for (const wire of this.wires) {
      const positions = wire.line.geometry.attributes.position.array as Float32Array;
      const pointCount = positions.length / 3;
      const rowOffset = wire.row - rowMidpoint;
      const echoFade = wire.echo === 0 ? 1 : 0.62;

      for (let column = 0; column < pointCount; column += 1) {
        const progress = column / (pointCount - 1);
        const offset = column * 3;
        const mirrored = 1 - Math.abs(progress - 0.5) * 2;
        const wave = sampleWaveform(features.waveform, progress, Math.sin(progress * Math.PI * 4 + this.time));
        const band = sampleFrequency(features.bandEnvelopes, progress, 0.04);
        const peak = sampleFrequency(features.bandPeaks, progress, band);
        const contour =
          Math.sin(progress * Math.PI * (4.2 + signal.rolloff * 2.6) + this.time * (0.88 + signal.flux) + wire.phase) *
          (0.14 + band * 0.72 + peak * 0.28);
        const roughness =
          Math.sin(progress * Math.PI * 26 + wire.row * 0.9 + this.time * (1.4 + signal.flatness * 1.8)) *
          signal.flatness *
          (0.025 + peak * 0.12);
        const bassRipple =
          Math.sin(progress * Math.PI * 8 - this.time * 2.6 + rowOffset * 0.7) *
          (signal.bassPulse * 0.18 + signal.onset * 0.1);
        const x = (progress - 0.5) * span + Math.sin(this.time * 0.21 + wire.phase) * wire.echo * 0.18;
        const y =
          rowOffset * 0.42 +
          wave * waveDepth * echoFade +
          contour +
          roughness +
          bassRipple -
          wire.echo * 0.18;
        const z =
          wire.depth +
          mirrored * (1.2 + signal.bass * 0.85 + signal.bassPulse * 0.34) +
          band * 0.55 +
          Math.cos(progress * Math.PI * 3 + this.time * 0.46 + wire.phase) * (0.12 + signal.treble * 0.18);

        positions[offset] = x;
        positions[offset + 1] = y;
        positions[offset + 2] = z;
      }

      wire.line.geometry.attributes.position.needsUpdate = true;
      const material = wire.line.material as THREE.LineBasicMaterial;
      material.opacity =
        wire.opacity * (0.42 + signal.energy * 0.72 + signal.flux * 0.42 + signal.onset * 0.46 + signal.dynamics * 0.34);
    }

    this.group.rotation.z = Math.sin(this.time * 0.08) * (0.045 + signal.flatness * 0.035);
    this.group.rotation.y = Math.sin(this.time * 0.06) * 0.18 + signal.rolloff * 0.08;
    this.group.scale.setScalar(1 + signal.bass * 0.04 + signal.bassPulse * 0.03);
  }
}

interface FlowStrand {
  line: THREE.Line;
  phase: number;
  radius: number;
  speed: number;
  opacity: number;
}

class ChromaticFlowPreset extends PresetBase {
  id = 'chromatic-flow' as const;
  name = 'Chromatic Flow';
  private strands: FlowStrand[] = [];
  private particles?: THREE.Points;
  private particleBase = new Float32Array(0);
  private particleSeeds = new Float32Array(0);
  private particlePositions?: Float32Array;
  private time = 0;

  protected build(): void {
    const strands = 32;
    const points = 112;
    const colors = [this.palette.primary, this.palette.secondary, this.palette.hot, this.palette.glow, this.palette.soft];

    for (let index = 0; index < strands; index += 1) {
      const geometry = createLineGeometry(points);
      fillLineColors(geometry, colors[index % colors.length], colors[(index + 2) % colors.length]);
      const material = new THREE.LineBasicMaterial({
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.08 + (index % 5) * 0.018,
        transparent: true,
        vertexColors: true
      });
      const line = new THREE.Line(geometry, material);
      this.strands.push({
        line,
        phase: (index / strands) * Math.PI * 2,
        radius: 1.15 + (index % 8) * 0.28,
        speed: 0.22 + (index % 7) * 0.035,
        opacity: 0.08 + (index % 5) * 0.018
      });
      this.group.add(line);
    }

    const particleCount = 1_050;
    const positions = new Float32Array(particleCount * 3);
    const colorArray = new Float32Array(particleCount * 3);
    const base = new Float32Array(particleCount * 3);
    const seeds = new Float32Array(particleCount);
    const random = seededRandom(7001);
    const primary = new THREE.Color(this.palette.primary);
    const secondary = new THREE.Color(this.palette.secondary);
    const hot = new THREE.Color(this.palette.hot);

    for (let index = 0; index < particleCount; index += 1) {
      const offset = index * 3;
      const seed = random();
      const angle = random() * Math.PI * 2;
      const radius = Math.pow(random(), 0.55) * 5.2;
      const z = -2.8 + random() * 5.8;
      const color = primary.clone().lerp(secondary, random()).lerp(hot, seed > 0.78 ? 0.34 : 0.04);

      base[offset] = Math.cos(angle) * radius;
      base[offset + 1] = Math.sin(angle) * radius * 0.82;
      base[offset + 2] = z;
      positions[offset] = base[offset];
      positions[offset + 1] = base[offset + 1];
      positions[offset + 2] = z;
      colorArray[offset] = color.r;
      colorArray[offset + 1] = color.g;
      colorArray[offset + 2] = color.b;
      seeds[index] = seed;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
    const material = new THREE.PointsMaterial({
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: 0.22,
      size: 0.022,
      transparent: true,
      vertexColors: true
    });
    this.particleBase = base;
    this.particlePositions = positions;
    this.particleSeeds = seeds;
    this.particles = new THREE.Points(geometry, material);
    this.group.add(this.particles);
  }

  update(features: AudioFeatures, deltaMs: number): void {
    const signal = this.readSignal(features, deltaMs);
    this.time += deltaMs * 0.001;
    const colorDrift = signal.centroid * 0.7 + signal.rolloff * 0.45;

    for (const strand of this.strands) {
      const positions = strand.line.geometry.attributes.position.array as Float32Array;
      const pointCount = positions.length / 3;
      const twist = this.time * (strand.speed + signal.flux * 0.38 + signal.rolloff * 0.18) + strand.phase;

      for (let point = 0; point < pointCount; point += 1) {
        const progress = point / (pointCount - 1);
        const offset = point * 3;
        const wave = sampleWaveform(features.waveform, positiveModulo(progress + strand.phase / (Math.PI * 2), 1), 0);
        const band = sampleFrequency(features.bandEnvelopes, positiveModulo(progress + signal.centroid * 0.16, 1), 0.03);
        const peak = sampleFrequency(features.bandPeaks, progress, band);
        const spiral = progress * Math.PI * (4.6 + signal.flatness * 3.2) + twist;
        const braid = Math.sin(progress * Math.PI * 8 + this.time * (0.8 + signal.flux) + strand.phase);
        const radius =
          strand.radius +
          progress * (1.1 + signal.energy * 0.72) +
          band * 0.78 +
          peak * 0.28 +
          wave * (0.28 + signal.dynamics * 0.48) +
          signal.onset * 0.26;

        positions[offset] = Math.cos(spiral) * radius + Math.sin(twist * 0.6 + progress * 7) * (0.25 + signal.mid * 0.32);
        positions[offset + 1] =
          Math.sin(spiral * 0.74 + strand.phase * 0.2) * radius * 0.72 +
          braid * (0.2 + signal.treble * 0.42 + signal.treblePulse * 0.36);
        positions[offset + 2] =
          -2.7 +
          progress * 5.4 +
          Math.sin(spiral * 0.36 + colorDrift) * (0.52 + signal.flatness * 0.38) +
          peak * 0.26;
      }

      strand.line.geometry.attributes.position.needsUpdate = true;
      const material = strand.line.material as THREE.LineBasicMaterial;
      material.opacity = strand.opacity * (0.72 + signal.energy * 1.05 + signal.flux * 1.2 + signal.onset * 0.82);
    }

    if (this.particles && this.particlePositions) {
      for (let index = 0; index < this.particlePositions.length; index += 3) {
        const seed = this.particleSeeds[index / 3];
        const baseX = this.particleBase[index];
        const baseY = this.particleBase[index + 1];
        const baseZ = this.particleBase[index + 2];
        const radius = Math.hypot(baseX, baseY);
        const angle =
          Math.atan2(baseY, baseX) +
          this.time * (0.1 + seed * 0.25 + signal.centroid * 0.14) +
          signal.flux * 0.18;
        const band = sampleFrequency(features.bandEnvelopes, seed, 0.02);
        const drift = Math.sin(this.time * (0.75 + seed) + radius * 1.6) * (0.08 + band * 0.34 + signal.flatness * 0.14);

        this.particlePositions[index] = Math.cos(angle) * (radius + drift + signal.onset * seed * 0.35);
        this.particlePositions[index + 1] =
          Math.sin(angle) * (radius * 0.78 + drift) + Math.cos(this.time * 0.4 + seed * 7) * signal.midPulse * 0.22;
        this.particlePositions[index + 2] =
          baseZ + Math.sin(angle * 2.3 + this.time) * (0.18 + signal.treble * 0.28) + band * 0.42;
      }

      this.particles.geometry.attributes.position.needsUpdate = true;
      const material = this.particles.material as THREE.PointsMaterial;
      material.opacity = 0.1 + signal.energy * 0.22 + signal.flux * 0.22 + signal.onset * 0.18;
      material.size = 0.016 + signal.treble * 0.014 + signal.treblePulse * 0.018;
    }

    this.group.rotation.x = Math.sin(this.time * 0.07) * (0.12 + signal.flatness * 0.08);
    this.group.rotation.y = Math.cos(this.time * 0.08) * 0.14 + signal.rolloff * 0.08;
    this.group.rotation.z = Math.sin(this.time * 0.05) * 0.04;
    this.group.scale.setScalar(0.94 + signal.energy * 0.08 + signal.onset * 0.04);
  }
}

interface ScopeBar {
  bar: THREE.Mesh;
  cap: THREE.Mesh;
  index: number;
  baseColor: THREE.Color;
}

interface ScopeTrace {
  mesh: THREE.Mesh;
  offsetY: number;
  phase: number;
  thickness: number;
  opacity: number;
}

class SignalScopePreset extends PresetBase {
  id = 'signal-scope' as const;
  name = 'Signal Scope';
  private bars: ScopeBar[] = [];
  private traces: ScopeTrace[] = [];
  private sweep?: THREE.Mesh;
  private time = 0;

  protected build(): void {
    const barCount = 72;
    const barGeometry = new THREE.BoxGeometry(0.075, 1, 0.055);
    const capGeometry = new THREE.BoxGeometry(0.09, 0.045, 0.075);
    const primary = new THREE.Color(this.palette.primary);
    const secondary = new THREE.Color(this.palette.secondary);
    const hot = new THREE.Color(this.palette.hot);

    for (let index = 0; index < barCount; index += 1) {
      const progress = index / Math.max(1, barCount - 1);
      const color = primary.clone().lerp(secondary, progress);
      if (index % 9 === 0) {
        color.lerp(hot, 0.42);
      }

      const barMaterial = new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        color,
        depthWrite: false,
        opacity: 0.48,
        transparent: true
      });
      const capMaterial = new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        color: hot.clone().lerp(color, 0.35),
        depthWrite: false,
        opacity: 0.42,
        transparent: true
      });
      const bar = new THREE.Mesh(barGeometry.clone(), barMaterial);
      const cap = new THREE.Mesh(capGeometry.clone(), capMaterial);
      this.bars.push({ bar, cap, index, baseColor: color });
      this.group.add(bar, cap);
    }

    const traceColors = [this.palette.glow, this.palette.primary, this.palette.hot];
    for (let index = 0; index < 3; index += 1) {
      const geometry = createStripGeometry(292, false);
      fillStripColors(geometry, traceColors[index], traceColors[(index + 1) % traceColors.length]);
      const material = new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.28 - index * 0.055,
        side: THREE.DoubleSide,
        transparent: true,
        vertexColors: true
      });
      const mesh = new THREE.Mesh(geometry, material);
      this.traces.push({
        mesh,
        offsetY: 0.36 + index * 0.42,
        phase: index * 0.17,
        thickness: 0.028 + index * 0.012,
        opacity: 0.28 - index * 0.055
      });
      this.group.add(mesh);
    }

    const sweepGeometry = new THREE.BoxGeometry(0.035, 6.4, 0.045);
    const sweepMaterial = new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: this.palette.glow,
      depthWrite: false,
      opacity: 0.12,
      transparent: true
    });
    this.sweep = new THREE.Mesh(sweepGeometry, sweepMaterial);
    this.group.add(this.sweep);
  }

  update(features: AudioFeatures, deltaMs: number): void {
    const signal = this.readSignal(features, deltaMs);
    this.time += deltaMs * 0.001;
    const span = this.size.width < 720 ? 10.2 : 12.2;
    const floor = -3.08;
    const hot = new THREE.Color(this.palette.hot);
    const glow = new THREE.Color(this.palette.glow);

    for (const entry of this.bars) {
      const progress = entry.index / Math.max(1, this.bars.length - 1);
      const band = sampleFrequency(features.bandEnvelopes, progress, 0.025);
      const peak = sampleFrequency(features.bandPeaks, progress, band);
      const bandPulse = progress < 0.2 ? signal.bassPulse : progress < 0.66 ? signal.midPulse : signal.treblePulse;
      const height = 0.08 + band * 3.25 + peak * 0.74 + bandPulse * 0.62 + signal.onset * 0.18;
      const peakHeight = 0.1 + peak * 3.42 + bandPulse * 0.45 + signal.dynamics * 0.24;
      const x = (progress - 0.5) * span;
      const z = -0.82 + Math.sin(this.time * 0.8 + progress * Math.PI * 3) * (0.08 + signal.flatness * 0.18);

      entry.bar.position.set(x, floor + height / 2, z);
      entry.bar.scale.set(1 + signal.onset * 0.12 + bandPulse * 0.12, height, 1 + peak * 0.28);
      entry.cap.position.set(x, floor + peakHeight + 0.08, z + 0.04);
      entry.cap.scale.set(1 + peak * 0.5, 1, 1 + signal.treblePulse * 0.24);

      const barMaterial = entry.bar.material as THREE.MeshBasicMaterial;
      const capMaterial = entry.cap.material as THREE.MeshBasicMaterial;
      barMaterial.color.copy(entry.baseColor).lerp(hot, signal.rolloff * 0.22 + bandPulse * 0.2).lerp(glow, signal.treblePulse * 0.12);
      barMaterial.opacity = 0.16 + band * 0.46 + peak * 0.28 + signal.energy * 0.16 + bandPulse * 0.14;
      capMaterial.opacity = 0.16 + peak * 0.34 + bandPulse * 0.24 + signal.onset * 0.16;
    }

    for (const trace of this.traces) {
      const positions = trace.mesh.geometry.attributes.position.array as Float32Array;
      const pointCount = positions.length / 6;

      for (let point = 0; point < pointCount; point += 1) {
        const progress = point / (pointCount - 1);
        const offset = point * 6;
        const waveform = sampleWaveform(features.waveform, positiveModulo(progress + trace.phase, 1), 0);
        const band = sampleFrequency(features.bandEnvelopes, progress, 0.03);
        const peak = sampleFrequency(features.bandPeaks, progress, band);
        const x = (progress - 0.5) * span;
        const beam =
          trace.offsetY +
          waveform * (0.62 + signal.mid * 1.05 + signal.dynamics * 0.52) +
          Math.sin(progress * Math.PI * 5 + this.time * (0.78 + signal.rolloff * 0.5) + trace.phase * 4) *
            (0.06 + signal.flatness * 0.16 + peak * 0.12) +
          band * (0.34 + signal.treble * 0.24);
        const thickness = trace.thickness * (1 + signal.energy * 1.1 + signal.onset * 0.75) + peak * 0.018;
        const z = 0.28 + Math.sin(this.time * 0.42 + trace.phase + progress * Math.PI * 2) * (0.05 + signal.treble * 0.18);

        positions[offset] = x;
        positions[offset + 1] = beam + thickness;
        positions[offset + 2] = z;
        positions[offset + 3] = x;
        positions[offset + 4] = beam - thickness;
        positions[offset + 5] = z - 0.035;
      }

      trace.mesh.geometry.attributes.position.needsUpdate = true;
      const material = trace.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = trace.opacity * (0.62 + signal.energy * 0.72 + signal.flux * 0.48 + signal.onset * 0.52);
    }

    if (this.sweep) {
      const sweepProgress = positiveModulo(this.time * (0.095 + signal.energy * 0.12 + signal.flux * 0.08), 1);
      const x = (sweepProgress - 0.5) * (span + 0.7);
      const material = this.sweep.material as THREE.MeshBasicMaterial;
      this.sweep.position.set(x, -0.12 + signal.onset * 0.2, -0.05);
      this.sweep.scale.set(1 + signal.onset * 0.8, 1 + signal.energy * 0.12, 1);
      material.opacity = 0.06 + signal.energy * 0.1 + signal.onset * 0.18 + signal.flux * 0.1;
    }

    this.group.rotation.x = -0.02 + Math.sin(this.time * 0.07) * (0.04 + signal.flatness * 0.05);
    this.group.rotation.y = Math.sin(this.time * 0.05) * 0.08 + signal.centroid * 0.04;
    this.group.scale.setScalar(1 + signal.bassPulse * 0.025 + signal.onset * 0.02);
  }
}

function createLineGeometry(pointCount: number): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pointCount * 3), 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pointCount * 3), 3));
  return geometry;
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

function fillLineColors(geometry: THREE.BufferGeometry, start: string, end: string): void {
  const colors = geometry.attributes.color.array as Float32Array;
  const startColor = new THREE.Color(start);
  const endColor = new THREE.Color(end);
  const pointCount = colors.length / 3;

  for (let index = 0; index < pointCount; index += 1) {
    const progress = index / Math.max(1, pointCount - 1);
    const color = startColor.clone().lerp(endColor, progress);
    const offset = index * 3;
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
  }

  geometry.attributes.color.needsUpdate = true;
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
