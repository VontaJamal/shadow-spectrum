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

abstract class PresetBase implements VisualizerPreset {
  abstract id: PresetId;
  abstract name: string;
  protected group = new THREE.Group();
  protected size: Size = { width: 1, height: 1 };

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

  abstract update(features: AudioFeatures, deltaMs: number): void;
  protected abstract build(): void;
}

class ParticleFieldPreset extends PresetBase {
  id = 'particle-field' as const;
  name = 'Particle field';
  private points?: THREE.Points;
  private basePositions = new Float32Array(0);
  private positions?: Float32Array;
  private material?: THREE.PointsMaterial;
  private time = 0;

  protected build(): void {
    const count = 1_800;
    const positions = new Float32Array(count * 3);
    const base = new Float32Array(count * 3);

    for (let index = 0; index < count; index += 1) {
      const radius = 2.2 + Math.random() * 5.8;
      const angle = Math.random() * Math.PI * 2;
      const depth = (Math.random() - 0.5) * 9;
      const offset = index * 3;
      base[offset] = Math.cos(angle) * radius;
      base[offset + 1] = Math.sin(angle) * radius;
      base[offset + 2] = depth;
      positions.set(base.slice(offset, offset + 3), offset);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0.82,
      size: 0.045,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.basePositions = base;
    this.positions = positions;
    this.material = material;
    this.points = new THREE.Points(geometry, material);
    this.group.add(this.points);
  }

  update(features: AudioFeatures, deltaMs: number): void {
    if (!this.points || !this.positions || !this.material) {
      return;
    }

    this.time += deltaMs * 0.001;
    const energy = features.rms + features.beatPulse * 0.7;
    const bassPush = 1 + features.bass * 0.75;

    for (let index = 0; index < this.positions.length; index += 3) {
      const baseX = this.basePositions[index];
      const baseY = this.basePositions[index + 1];
      const baseZ = this.basePositions[index + 2];
      const wave = Math.sin(this.time * 2 + baseZ + baseX * 0.6) * energy;
      this.positions[index] = baseX * bassPush + wave * 0.3;
      this.positions[index + 1] = baseY * (1 + features.mid * 0.36) + Math.cos(this.time + baseX) * energy * 0.32;
      this.positions[index + 2] = baseZ + Math.sin(this.time * 2.4 + baseY) * (0.6 + features.treble);
    }

    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.rotation.z += deltaMs * 0.00005 + features.centroid * 0.0008;
    this.points.rotation.y = Math.sin(this.time * 0.18) * 0.22;
    this.material.size = 0.036 + energy * 0.055;
    this.material.color.set(features.treble > features.bass ? this.palette.secondary : this.palette.primary);
  }
}

class LiquidRibbonsPreset extends PresetBase {
  id = 'liquid-ribbons' as const;
  name = 'Liquid ribbons';
  private lines: THREE.Line[] = [];
  private time = 0;

  protected build(): void {
    const rows = 7;
    const columns = 160;

    for (let row = 0; row < rows; row += 1) {
      const geometry = new THREE.BufferGeometry();
      const positions = new Float32Array(columns * 3);
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const material = new THREE.LineBasicMaterial({
        color: row % 2 === 0 ? this.palette.primary : this.palette.hot,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending
      });
      const line = new THREE.Line(geometry, material);
      line.userData.row = row;
      this.lines.push(line);
      this.group.add(line);
    }
  }

  update(features: AudioFeatures, deltaMs: number): void {
    this.time += deltaMs * 0.001;
    const amplitude = 0.5 + features.mid * 1.8 + features.beatPulse * 1.4;

    for (const line of this.lines) {
      const row = Number(line.userData.row);
      const positions = line.geometry.attributes.position.array as Float32Array;
      const rowOffset = row - (this.lines.length - 1) / 2;

      for (let column = 0; column < positions.length / 3; column += 1) {
        const progress = column / (positions.length / 3 - 1);
        const x = (progress - 0.5) * 13;
        const freq = features.frequencyBins[Math.floor(progress * (features.frequencyBins.length - 1))] ?? 0;
        const phase = this.time * (1.1 + row * 0.08) + progress * 9;
        const y = rowOffset * 0.42 + Math.sin(phase) * amplitude * (0.35 + freq);
        const z = Math.cos(phase * 0.7 + row) * (0.9 + features.bass * 1.8);
        const offset = column * 3;
        positions[offset] = x;
        positions[offset + 1] = y;
        positions[offset + 2] = z;
      }

      line.geometry.attributes.position.needsUpdate = true;
      line.rotation.z = Math.sin(this.time * 0.17) * 0.05;
      const material = line.material as THREE.LineBasicMaterial;
      material.opacity = 0.38 + features.rms * 0.9;
    }
  }
}

class SpectralBloomPreset extends PresetBase {
  id = 'spectral-bloom' as const;
  name = 'Spectral bloom';
  private bars: THREE.Mesh[] = [];
  private halo?: THREE.Mesh;
  private time = 0;

  protected build(): void {
    const count = 96;
    const barGeometry = new THREE.BoxGeometry(0.055, 0.55, 0.055);

    for (let index = 0; index < count; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: index % 3 === 0 ? this.palette.hot : this.palette.primary,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });
      const mesh = new THREE.Mesh(barGeometry.clone(), material);
      mesh.userData.index = index;
      this.bars.push(mesh);
      this.group.add(mesh);
    }

    const haloGeometry = new THREE.TorusGeometry(2.2, 0.015, 8, 180);
    const haloMaterial = new THREE.MeshBasicMaterial({
      color: this.palette.secondary,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending
    });
    this.halo = new THREE.Mesh(haloGeometry, haloMaterial);
    this.group.add(this.halo);
  }

  update(features: AudioFeatures, deltaMs: number): void {
    this.time += deltaMs * 0.001;
    const radius = 2.1 + features.bass * 1.2;

    for (const bar of this.bars) {
      const index = Number(bar.userData.index);
      const progress = index / this.bars.length;
      const bin = features.frequencyBins[Math.floor(progress * (features.frequencyBins.length - 1))] ?? 0;
      const angle = progress * Math.PI * 2 + this.time * 0.12;
      const length = 0.38 + bin * 2.9 + features.beatPulse * 0.55;
      bar.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, Math.sin(this.time + progress * 10) * 0.45);
      bar.scale.set(1, length, 1);
      bar.rotation.z = angle - Math.PI / 2;
      const material = bar.material as THREE.MeshBasicMaterial;
      material.opacity = 0.28 + bin * 0.75;
    }

    if (this.halo) {
      this.halo.scale.setScalar(1 + features.beatPulse * 0.35 + features.rms * 0.24);
      this.halo.rotation.z -= deltaMs * 0.00012;
      const material = this.halo.material as THREE.MeshBasicMaterial;
      material.opacity = 0.18 + features.beatPulse * 0.55;
    }

    this.group.rotation.z += deltaMs * 0.00006 + features.centroid * 0.0003;
  }
}

class WaveformOrbitPreset extends PresetBase {
  id = 'waveform-orbit' as const;
  name = 'Waveform orbit';
  private line?: THREE.Line;
  private material?: THREE.LineBasicMaterial;
  private time = 0;

  protected build(): void {
    const points = 256;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points * 3), 3));
    const material = new THREE.LineBasicMaterial({
      color: this.palette.primary,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending
    });
    this.material = material;
    this.line = new THREE.LineLoop(geometry, material);
    this.group.add(this.line);
  }

  update(features: AudioFeatures, deltaMs: number): void {
    if (!this.line || !this.material) {
      return;
    }

    this.time += deltaMs * 0.001;
    const positions = this.line.geometry.attributes.position.array as Float32Array;
    const pointCount = positions.length / 3;

    for (let index = 0; index < pointCount; index += 1) {
      const progress = index / pointCount;
      const waveform = features.waveform[Math.floor(progress * (features.waveform.length - 1))] ?? 0;
      const freq = features.frequencyBins[Math.floor(progress * (features.frequencyBins.length - 1))] ?? 0;
      const angle = progress * Math.PI * 2;
      const radius = 2.4 + waveform * (0.7 + features.mid * 1.5) + freq * 0.85 + features.beatPulse * 0.7;
      const offset = index * 3;
      positions[offset] = Math.cos(angle) * radius;
      positions[offset + 1] = Math.sin(angle) * radius;
      positions[offset + 2] = Math.sin(this.time + progress * 7) * (0.5 + features.treble);
    }

    this.line.geometry.attributes.position.needsUpdate = true;
    this.line.rotation.z += deltaMs * 0.0001 + features.centroid * 0.0012;
    this.group.scale.setScalar(1 + features.bass * 0.12);
    this.material.color.set(features.beatPulse > 0.25 ? this.palette.hot : this.palette.primary);
    this.material.opacity = 0.46 + features.rms * 1.2;
  }
}

