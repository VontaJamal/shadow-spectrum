import * as THREE from 'three';
import type { AudioFeatures } from '../audio/types';
import type { Palette, PresetId, Size, VisualizerPreset } from './types';

export function createPreset(id: PresetId, palette: Palette): VisualizerPreset {
  if (id === 'liquid-ribbons') {
    return new LiquidRibbonsPreset(palette);
  }

  if (id === 'spectral-bloom') {
    return new SpectralBloomPreset(palette);
  }

  if (id === 'waveform-orbit') {
    return new WaveformOrbitPreset(palette);
  }

  return new ParticleFieldPreset(palette);
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
      const mesh = object as THREE.Mesh | THREE.Points | THREE.Line;
      mesh.geometry?.dispose();
      const material = mesh.material;
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

class ParticleFieldPreset extends PresetBase {
  id = 'particle-field' as const;
  name = 'Particle field';
  private points?: THREE.Points;
  private material?: THREE.ShaderMaterial;
  private basePositions = new Float32Array(0);
  private baseColors = new Float32Array(0);
  private positions?: Float32Array;
  private colors?: Float32Array;
  private seeds = new Float32Array(0);
  private shockRings: THREE.Mesh[] = [];
  private time = 0;

  protected build(): void {
    const count = 4_400;
    const positions = new Float32Array(count * 3);
    const base = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const baseColors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const seeds = new Float32Array(count);
    const random = seededRandom(9143);
    const clusters = Array.from({ length: 11 }, (_entry, index) => {
      const angle = (index / 11) * Math.PI * 2 + random() * 0.8;
      const radius = 1.1 + random() * 4.4;
      return {
        x: Math.cos(angle) * radius * 0.92,
        y: Math.sin(angle * 1.17) * radius * 0.42,
        z: -3.8 + random() * 6.4,
        spread: 0.42 + random() * 1.65
      };
    });

    const primary = new THREE.Color(this.palette.primary);
    const secondary = new THREE.Color(this.palette.secondary);
    const hot = new THREE.Color(this.palette.hot);
    const soft = new THREE.Color(this.palette.soft);

    for (let point = 0; point < count; point += 1) {
      const cluster = clusters[Math.floor(random() * clusters.length)];
      const localAngle = random() * Math.PI * 2;
      const localRadius = Math.pow(random(), 0.48) * cluster.spread;
      const depth = (random() - 0.5) * 2.2;
      const offset = point * 3;
      const seed = random();
      const color = primary.clone().lerp(secondary, random() * 0.72);

      if (seed > 0.82) {
        color.lerp(hot, 0.55);
      } else if (seed < 0.18) {
        color.lerp(soft, 0.34);
      }

      base[offset] = cluster.x + Math.cos(localAngle) * localRadius * (1.3 + random() * 0.8);
      base[offset + 1] = cluster.y + Math.sin(localAngle) * localRadius * (0.55 + random() * 0.6);
      base[offset + 2] = cluster.z + depth + Math.sin(localAngle * 2.0) * 0.55;
      positions.set(base.slice(offset, offset + 3), offset);
      baseColors[offset] = color.r;
      baseColors[offset + 1] = color.g;
      baseColors[offset + 2] = color.b;
      colors.set(baseColors.slice(offset, offset + 3), offset);
      sizes[point] = 0.36 + random() * 1.15;
      seeds[point] = seed;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.ShaderMaterial({
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      vertexColors: true,
      vertexShader: `
        attribute float aSize;
        varying vec3 vColor;

        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(aSize * (92.0 / -mvPosition.z), 1.0, 18.0);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;

        void main() {
          vec2 point = gl_PointCoord - vec2(0.5);
          float falloff = smoothstep(0.5, 0.03, length(point));
          float core = smoothstep(0.16, 0.0, length(point));
          gl_FragColor = vec4(vColor * (0.62 + core * 0.75), falloff * 0.86);
        }
      `
    });

    this.basePositions = base;
    this.baseColors = baseColors;
    this.positions = positions;
    this.colors = colors;
    this.seeds = seeds;
    this.material = material;
    this.points = new THREE.Points(geometry, material);
    this.group.add(this.points);

    for (let index = 0; index < 4; index += 1) {
      const geometry = new THREE.TorusGeometry(1.35 + index * 0.3, 0.01, 8, 180);
      const ringMaterial = new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        color: index % 2 === 0 ? this.palette.secondary : this.palette.hot,
        depthWrite: false,
        opacity: 0.08,
        transparent: true
      });
      const ring = new THREE.Mesh(geometry, ringMaterial);
      ring.rotation.x = 0.9 + index * 0.18;
      ring.rotation.y = -0.32 + index * 0.12;
      ring.userData.phase = index / 4;
      this.shockRings.push(ring);
      this.group.add(ring);
    }
  }

  update(features: AudioFeatures, deltaMs: number): void {
    if (!this.points || !this.positions || !this.colors || !this.material) {
      return;
    }

    const signal = this.readSignal(features, deltaMs);
    this.time += deltaMs * 0.001;
    const bassPush = 1 + signal.bass * 0.26 + signal.bassPulse * 0.34 + signal.onset * 0.12;
    const gravity = 0.88 + signal.mid * 0.32 + signal.dynamics * 0.14;

    for (let index = 0; index < this.positions.length; index += 3) {
      const point = index / 3;
      const seed = this.seeds[point];
      const baseX = this.basePositions[index];
      const baseY = this.basePositions[index + 1];
      const baseZ = this.basePositions[index + 2];
      const radius = Math.hypot(baseX, baseY);
      const orbit = this.time * (0.12 + seed * 0.18) + radius * 0.38;
      const band = sampleFrequency(features.bandEnvelopes, seed, 0.02);
      const peak = sampleFrequency(features.bandPeaks, seed, band);
      const ripple =
        Math.sin(radius * 1.38 - this.time * (3.2 + signal.flux * 1.4) + seed * 8.0) *
        (signal.onset * 0.56 + signal.energy * 0.14 + peak * 0.22);
      const shimmer =
        Math.sin(this.time * (1.4 + seed + signal.rolloff * 0.8) + baseZ * 1.2) *
        (0.08 + signal.treble * 0.28 + signal.treblePulse * 0.24 + band * 0.14);

      this.positions[index] = baseX * bassPush + Math.cos(orbit) * (0.08 + signal.centroid * 0.28 + band * 0.18) + ripple * 0.48;
      this.positions[index + 1] = baseY * gravity + Math.sin(orbit * 1.3) * (0.08 + signal.mid * 0.3 + peak * 0.16) + ripple * 0.22;
      this.positions[index + 2] = baseZ + shimmer + (signal.bass + signal.bassPulse * 0.6) * Math.sin(radius + this.time) * 0.55;

      const intensity = 0.52 + signal.energy * 0.52 + signal.treble * seed * 0.42 + signal.flux * 0.42 + peak * 0.58;
      this.colors[index] = clamp(this.baseColors[index] * intensity, 0, 1.8);
      this.colors[index + 1] = clamp(this.baseColors[index + 1] * intensity, 0, 1.8);
      this.colors[index + 2] = clamp(this.baseColors[index + 2] * intensity, 0, 1.8);
    }

    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.group.rotation.y = Math.sin(this.time * 0.13) * 0.18 + signal.centroid * 0.1;
    this.group.rotation.x = Math.cos(this.time * 0.11) * 0.08;
    this.points.rotation.z += deltaMs * 0.000035 + signal.centroid * 0.00028;

    for (const ring of this.shockRings) {
      const phase = (Number(ring.userData.phase) + this.time * 0.055) % 1;
      const material = ring.material as THREE.MeshBasicMaterial;
      ring.scale.setScalar(0.7 + phase * (3.7 + signal.bass * 1.2 + signal.dynamics * 0.8) + signal.bassPulse * 0.72 + signal.onset * 0.35);
      ring.rotation.z += deltaMs * 0.00008;
      material.opacity = (1 - phase) * (0.025 + signal.bassPulse * 0.26 + signal.onset * 0.12 + signal.energy * 0.04);
    }
  }
}

interface RibbonLayer {
  mesh: THREE.Mesh;
  row: number;
  width: number;
  opacity: number;
  depth: number;
}

class LiquidRibbonsPreset extends PresetBase {
  id = 'liquid-ribbons' as const;
  name = 'Liquid ribbons';
  private layers: RibbonLayer[] = [];
  private time = 0;

  protected build(): void {
    const rows = 5;
    const columns = 190;
    const paletteColors = [this.palette.primary, this.palette.secondary, this.palette.hot, this.palette.primary];

    for (let row = 0; row < rows; row += 1) {
      const layerDepth = -1.5 + row * 0.38;
      for (let echo = 0; echo < 2; echo += 1) {
        const geometry = createStripGeometry(columns, false);
        fillStripColors(geometry, paletteColors[(row + echo) % paletteColors.length], paletteColors[(row + echo + 1) % paletteColors.length]);
        const material = new THREE.MeshBasicMaterial({
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          opacity: echo === 0 ? 0.3 : 0.07,
          side: THREE.DoubleSide,
          transparent: true,
          vertexColors: true
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.userData.echo = echo;
        mesh.userData.row = row;
        this.layers.push({
          mesh,
          row,
          width: echo === 0 ? 0.058 : 0.15,
          opacity: echo === 0 ? 0.3 : 0.07,
          depth: layerDepth - echo * 0.36
        });
        this.group.add(mesh);
      }
    }

    this.group.rotation.x = -0.08;
  }

  update(features: AudioFeatures, deltaMs: number): void {
    const signal = this.readSignal(features, deltaMs);
    this.time += deltaMs * 0.001;
    const span = this.size.width < 720 ? 10.5 : 13.2;
    const amplitude = 0.34 + signal.mid * 1.15 + signal.midPulse * 0.84 + signal.dynamics * 0.46;
    const rowMidpoint = 2;

    for (const layer of this.layers) {
      const positions = layer.mesh.geometry.attributes.position.array as Float32Array;
      const pointCount = positions.length / 6;
      const rowOffset = layer.row - rowMidpoint;
      const echo = Number(layer.mesh.userData.echo);

      for (let column = 0; column < pointCount; column += 1) {
        const progress = column / (pointCount - 1);
        const offset = column * 6;
        const wave = sampleWaveform(features.waveform, progress, Math.sin(progress * Math.PI * 6 + this.time));
        const freq = sampleFrequency(features.bandEnvelopes, progress, 0.04);
        const peak = sampleFrequency(features.bandPeaks, progress, freq);
        const roughness = signal.flatness * Math.sin(progress * Math.PI * 18 + this.time * (1.2 + signal.flux));
        const phase =
          this.time * (0.72 + layer.row * 0.035 + signal.rolloff * 0.08) +
          progress * (8.5 + signal.centroid * 3.1 + signal.flatness * 2.8) +
          echo * 0.7;
        const x = (progress - 0.5) * span;
        const centerY =
          rowOffset * 0.5 +
          Math.sin(phase) * amplitude * (0.2 + freq * 0.74) +
          wave * (0.22 + signal.mid * 0.58 + signal.dynamics * 0.32) +
          roughness * (0.04 + peak * 0.18) -
          echo * 0.08;
        const centerZ =
          layer.depth +
          Math.cos(phase * 0.74 + rowOffset) * (0.34 + signal.bass * 0.72 + signal.bassPulse * 0.42) +
          freq * 0.38 +
          peak * 0.18;
        const width = layer.width * (1 + signal.energy * 0.72 + signal.flatness * 0.34) + freq * 0.12 + signal.onset * 0.08;

        positions[offset] = x;
        positions[offset + 1] = centerY + width;
        positions[offset + 2] = centerZ;
        positions[offset + 3] = x;
        positions[offset + 4] = centerY - width;
        positions[offset + 5] = centerZ - echo * 0.04;
      }

      layer.mesh.geometry.attributes.position.needsUpdate = true;
      const material = layer.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = layer.opacity * (0.58 + signal.rms * 0.62 + signal.onset * 0.36 + signal.flux * 0.28 + signal.dynamics * 0.22);
    }

    this.group.rotation.z = Math.sin(this.time * 0.1) * (0.032 + signal.flatness * 0.022);
    this.group.rotation.y = Math.sin(this.time * 0.08) * 0.14 + signal.rolloff * 0.08;
    this.group.scale.setScalar(1 + signal.bass * 0.035 + signal.bassPulse * 0.025);
  }
}

class SpectralBloomPreset extends PresetBase {
  id = 'spectral-bloom' as const;
  name = 'Spectral bloom';
  private bars: THREE.Mesh[] = [];
  private rings: THREE.Mesh[] = [];
  private core?: THREE.Mesh;
  private time = 0;

  protected build(): void {
    const count = 168;
    const barGeometry = new THREE.CylinderGeometry(0.018, 0.034, 1, 8, 1, false);
    const primary = new THREE.Color(this.palette.primary);
    const secondary = new THREE.Color(this.palette.secondary);
    const hot = new THREE.Color(this.palette.hot);

    for (let index = 0; index < count; index += 1) {
      const color = primary.clone().lerp(secondary, (index % 24) / 24);
      if (index % 11 === 0) {
        color.lerp(hot, 0.58);
      }

      const material = new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        color,
        depthWrite: false,
        opacity: 0.54,
        transparent: true
      });
      const mesh = new THREE.Mesh(barGeometry.clone(), material);
      mesh.userData.index = index;
      mesh.userData.baseColor = color.clone();
      this.bars.push(mesh);
      this.group.add(mesh);
    }

    for (let index = 0; index < 5; index += 1) {
      const geometry = new THREE.TorusGeometry(1.15 + index * 0.36, 0.012 + index * 0.002, 10, 220);
      const material = new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        color: index % 2 === 0 ? this.palette.secondary : this.palette.hot,
        depthWrite: false,
        opacity: 0.13,
        transparent: true
      });
      const ring = new THREE.Mesh(geometry, material);
      ring.userData.index = index;
      ring.rotation.x = index % 2 === 0 ? 0 : 0.18;
      this.rings.push(ring);
      this.group.add(ring);
    }

    const coreGeometry = new THREE.SphereGeometry(0.42, 48, 24);
    const coreMaterial = new THREE.MeshBasicMaterial({
      blending: THREE.AdditiveBlending,
      color: this.palette.glow,
      depthWrite: false,
      opacity: 0.18,
      transparent: true
    });
    this.core = new THREE.Mesh(coreGeometry, coreMaterial);
    this.group.add(this.core);
  }

  update(features: AudioFeatures, deltaMs: number): void {
    const signal = this.readSignal(features, deltaMs);
    this.time += deltaMs * 0.001;
    const radius = 1.72 + signal.bass * 0.62 + signal.bassPulse * 0.38 + signal.onset * 0.16;
    const hot = new THREE.Color(this.palette.hot);
    const glow = new THREE.Color(this.palette.glow);

    for (const bar of this.bars) {
      const index = Number(bar.userData.index);
      const progress = index / this.bars.length;
      const bin = sampleFrequency(features.bandEnvelopes, progress, 0.03);
      const peak = sampleFrequency(features.bandPeaks, progress, bin);
      const bandPulse = progress < 0.18 ? signal.bassPulse : progress < 0.62 ? signal.midPulse : signal.treblePulse;
      const angle = progress * Math.PI * 2 + this.time * (0.035 + signal.centroid * 0.055 + signal.rolloff * 0.045);
      const bloom = 0.3 + bin * 2.65 + peak * 0.86 + bandPulse * 0.88 + signal.onset * 0.42;
      const radial = radius + bloom * 0.38;
      const z = Math.sin(this.time * (0.9 + signal.flatness * 0.55) + progress * Math.PI * 8) * (0.18 + signal.treble * 0.34 + signal.treblePulse * 0.38);

      bar.position.set(Math.cos(angle) * radial, Math.sin(angle) * radial, z);
      bar.scale.set(1 + peak * 0.32, bloom, 1 + bin * 0.28);
      bar.rotation.z = angle - Math.PI / 2;
      bar.rotation.x = Math.sin(this.time * 0.25 + progress * 6) * (0.12 + signal.dynamics * 0.12);

      const material = bar.material as THREE.MeshBasicMaterial;
      const baseColor = bar.userData.baseColor as THREE.Color;
      material.color.copy(baseColor).lerp(hot, signal.rolloff * 0.22 + bandPulse * 0.16).lerp(glow, signal.treblePulse * 0.16);
      material.opacity = 0.16 + bin * 0.46 + peak * 0.24 + signal.energy * 0.14 + bandPulse * 0.18;
    }

    for (const ring of this.rings) {
      const index = Number(ring.userData.index);
      const material = ring.material as THREE.MeshBasicMaterial;
      const pulseScale = 1 + signal.onset * (0.18 + index * 0.035) + signal.bassPulse * 0.12 + signal.dynamics * 0.05;
      ring.scale.setScalar(pulseScale + Math.sin(this.time * 0.32 + index) * 0.012);
      ring.rotation.z += deltaMs * (index % 2 === 0 ? 0.00005 : -0.00007);
      material.opacity = 0.055 + signal.energy * 0.1 + signal.onset * (0.08 + index * 0.012) + signal.flux * 0.05;
    }

    if (this.core) {
      const material = this.core.material as THREE.MeshBasicMaterial;
      this.core.scale.setScalar(1 + signal.bass * 0.42 + signal.bassPulse * 0.45 + signal.onset * 0.55);
      material.opacity = 0.1 + signal.rms * 0.18 + signal.onset * 0.18 + signal.dynamics * 0.12;
    }

    this.group.rotation.z += deltaMs * 0.00004 + signal.rolloff * 0.00022;
    this.group.rotation.y = Math.sin(this.time * 0.12) * (0.16 + signal.flatness * 0.1);
  }
}

interface OrbitLayer {
  mesh: THREE.Mesh;
  radius: number;
  thickness: number;
  opacity: number;
  phase: number;
}

class WaveformOrbitPreset extends PresetBase {
  id = 'waveform-orbit' as const;
  name = 'Waveform orbit';
  private layers: OrbitLayer[] = [];
  private dust?: THREE.Points;
  private dustBase = new Float32Array(0);
  private dustPositions?: Float32Array;
  private time = 0;

  protected build(): void {
    const points = 320;
    const colors = [this.palette.primary, this.palette.secondary, this.palette.hot, this.palette.soft];

    for (let index = 0; index < 5; index += 1) {
      const geometry = createStripGeometry(points, true);
      fillStripColors(geometry, colors[index % colors.length], colors[(index + 1) % colors.length]);
      const material = new THREE.MeshBasicMaterial({
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        opacity: 0.48 - index * 0.07,
        side: THREE.DoubleSide,
        transparent: true,
        vertexColors: true
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = index % 2 === 0 ? 0.08 : -0.12;
      this.layers.push({
        mesh,
        radius: 2.1 + index * 0.2,
        thickness: 0.035 + index * 0.014,
        opacity: 0.46 - index * 0.065,
        phase: index * 0.2
      });
      this.group.add(mesh);
    }

    const dustCount = 520;
    const positions = new Float32Array(dustCount * 3);
    const base = new Float32Array(dustCount * 3);
    const random = seededRandom(2227);

    for (let index = 0; index < dustCount; index += 1) {
      const offset = index * 3;
      const angle = random() * Math.PI * 2;
      const radius = 1.45 + random() * 3.1;
      base[offset] = Math.cos(angle) * radius;
      base[offset + 1] = Math.sin(angle) * radius;
      base[offset + 2] = (random() - 0.5) * 2.6;
      positions.set(base.slice(offset, offset + 3), offset);
    }

    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const dustMaterial = new THREE.PointsMaterial({
      blending: THREE.AdditiveBlending,
      color: this.palette.secondary,
      depthWrite: false,
      opacity: 0.22,
      size: 0.02,
      transparent: true
    });
    this.dustBase = base;
    this.dustPositions = positions;
    this.dust = new THREE.Points(dustGeometry, dustMaterial);
    this.group.add(this.dust);
  }

  update(features: AudioFeatures, deltaMs: number): void {
    const signal = this.readSignal(features, deltaMs);
    this.time += deltaMs * 0.001;

    for (const layer of this.layers) {
      const positions = layer.mesh.geometry.attributes.position.array as Float32Array;
      const pointCount = positions.length / 6;

      for (let index = 0; index < pointCount; index += 1) {
        const progress = index / pointCount;
        const offset = index * 6;
        const waveform = sampleWaveform(features.waveform, (progress + layer.phase) % 1, Math.sin(progress * Math.PI * 2));
        const freq = sampleFrequency(features.bandEnvelopes, progress, 0.04);
        const peak = sampleFrequency(features.bandPeaks, progress, freq);
        const angle = progress * Math.PI * 2;
        const breathing =
          Math.sin(this.time * (0.7 + signal.rolloff * 0.32) + progress * Math.PI * 6 + layer.phase) *
          (0.04 + signal.treble * 0.16 + signal.flatness * 0.1);
        const radius =
          layer.radius +
          waveform * (0.18 + signal.mid * 0.62 + signal.dynamics * 0.34) +
          freq * (0.18 + signal.treble * 0.36) +
          peak * (0.12 + signal.flatness * 0.22) +
          signal.onset * 0.36 +
          breathing;
        const thickness = layer.thickness * (1 + signal.energy * 0.95 + signal.dynamics * 0.72) + freq * 0.035 + signal.flatness * 0.012;
        const z =
          Math.sin(this.time * 0.52 + progress * Math.PI * 4 + layer.phase) *
          (0.18 + signal.treble * 0.42 + signal.treblePulse * 0.38 + signal.rolloff * 0.12);

        positions[offset] = Math.cos(angle) * (radius + thickness);
        positions[offset + 1] = Math.sin(angle) * (radius + thickness);
        positions[offset + 2] = z;
        positions[offset + 3] = Math.cos(angle) * (radius - thickness);
        positions[offset + 4] = Math.sin(angle) * (radius - thickness);
        positions[offset + 5] = z - 0.02;
      }

      layer.mesh.geometry.attributes.position.needsUpdate = true;
      const material = layer.mesh.material as THREE.MeshBasicMaterial;
      material.opacity = layer.opacity * (0.54 + signal.rms * 0.58 + signal.onset * 0.34 + signal.dynamics * 0.3);
      layer.mesh.rotation.z += deltaMs * (0.00004 + layer.phase * 0.00006) + signal.rolloff * 0.00034;
    }

    if (this.dust && this.dustPositions) {
      for (let index = 0; index < this.dustPositions.length; index += 3) {
        const baseX = this.dustBase[index];
        const baseY = this.dustBase[index + 1];
        const baseZ = this.dustBase[index + 2];
        const radius = Math.hypot(baseX, baseY);
        const angle = Math.atan2(baseY, baseX) + this.time * (0.04 + signal.centroid * 0.08);
        const band = sampleFrequency(features.bandEnvelopes, (radius % 4.6) / 4.6, 0.02);
        const drift = Math.sin(this.time * (1.1 + signal.flux) + radius * 2.3) * (0.04 + signal.treble * 0.18 + band * 0.18);
        this.dustPositions[index] = Math.cos(angle) * (radius + drift);
        this.dustPositions[index + 1] = Math.sin(angle) * (radius + drift);
        this.dustPositions[index + 2] = baseZ + (signal.bass + signal.bassPulse * 0.5) * Math.sin(angle * 3) * 0.38 + band * 0.22;
      }
      this.dust.geometry.attributes.position.needsUpdate = true;
      const material = this.dust.material as THREE.PointsMaterial;
      material.opacity = 0.1 + signal.energy * 0.16 + signal.flux * 0.12;
      material.size = 0.015 + signal.treble * 0.018 + signal.treblePulse * 0.02;
    }

    this.group.rotation.x = Math.sin(this.time * 0.09) * (0.13 + signal.flatness * 0.08);
    this.group.rotation.y = Math.cos(this.time * 0.11) * 0.12 + signal.rolloff * 0.04;
    this.group.scale.setScalar(1 + signal.bass * 0.06 + signal.onset * 0.04);
  }
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
