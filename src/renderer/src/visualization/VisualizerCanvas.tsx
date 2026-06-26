import { useEffect, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { AfterimagePass } from 'three/examples/jsm/postprocessing/AfterimagePass.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { AudioFeatures } from '../audio/types';
import { VISUAL_BAND_COUNT, createSilentAudioFeatures } from '../audio/featureExtractor';
import { createPreset } from './presets';
import { getPalette } from './options';
import type { PaletteId, PresetId, VisualizerPreset } from './types';

interface VisualizerCanvasProps {
  featuresRef: MutableRefObject<AudioFeatures>;
  paletteId: PaletteId;
  presetId: PresetId;
  running: boolean;
}

export function VisualizerCanvas({ featuresRef, paletteId, presetId, running }: VisualizerCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const presetRef = useRef<VisualizerPreset | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const renderer = new THREE.WebGLRenderer({
      alpha: false,
      antialias: true,
      canvas,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.96;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const initialPalette = getPalette(paletteId);
    scene.background = new THREE.Color(initialPalette.background);
    scene.fog = new THREE.FogExp2(initialPalette.fog, 0.035);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
    camera.position.set(0, 0, 10.8);

    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    scene.add(ambient);
    const renderPass = new RenderPass(scene, camera);
    const afterimagePass = new AfterimagePass(0.88);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.72, 0.58, 0.08);
    const composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    composer.addPass(afterimagePass);
    composer.addPass(bloomPass);
    const director = new SceneDirector();

    const resize = (): void => {
      const width = canvas.clientWidth || window.innerWidth;
      const height = canvas.clientHeight || window.innerHeight;
      renderer.setSize(width, height, false);
      composer.setSize(width, height);
      bloomPass.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      presetRef.current?.resize({ width, height });
    };

    const swapPreset = (nextPresetId: PresetId, nextPaletteId: PaletteId): void => {
      const nextPalette = getPalette(nextPaletteId);
      presetRef.current?.dispose();
      renderer.setClearColor(nextPalette.background, 1);
      scene.background = new THREE.Color(nextPalette.background);
      scene.fog = new THREE.FogExp2(nextPalette.fog, 0.035);
      director.reset();
      presetRef.current = createPreset(nextPresetId, nextPalette);
      presetRef.current.init(scene);
      resize();
    };

    swapPreset(presetId, paletteId);
    resize();

    let lastPresetId = presetId;
    let lastPaletteId = paletteId;
    let lastTime = performance.now();
    let rafId = 0;

    const animate = (time: number): void => {
      if (lastPresetId !== presetId || lastPaletteId !== paletteId) {
        lastPresetId = presetId;
        lastPaletteId = paletteId;
        swapPreset(presetId, paletteId);
      }

      const deltaMs = time - lastTime;
      lastTime = time;
      const features = running ? featuresRef.current : createIdlePulse(time);
      const directed = director.update(time, features, deltaMs);

      camera.position.x = directed.cameraX;
      camera.position.y = directed.cameraY;
      camera.position.z = directed.cameraZ;
      camera.lookAt(0, 0, 0);
      renderer.toneMappingExposure = directed.exposure;
      bloomPass.strength = directed.bloomStrength;
      bloomPass.radius = directed.bloomRadius;
      afterimagePass.uniforms.damp.value = directed.afterimageDamp;
      if (scene.fog instanceof THREE.FogExp2) {
        scene.fog.density = directed.fogDensity;
      }

      presetRef.current?.update(features, deltaMs);
      composer.render();
      rafId = window.requestAnimationFrame(animate);
    };

    window.addEventListener('resize', resize);
    rafId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      presetRef.current?.dispose();
      composer.dispose();
      renderer.dispose();
      scene.clear();
      sceneRef.current = null;
    };
  }, [featuresRef, paletteId, presetId, running]);

  return <canvas aria-label="Audio visualizer canvas" className="visualizer-canvas" ref={canvasRef} />;
}

function createIdlePulse(time: number): AudioFeatures {
  const silent = createSilentAudioFeatures();
  const pulse = (Math.sin(time / 900) + 1) / 2;
  const bands = new Float32Array(VISUAL_BAND_COUNT);
  const bandEnvelopes = new Float32Array(VISUAL_BAND_COUNT);
  const bandPeaks = new Float32Array(VISUAL_BAND_COUNT);
  for (let index = 0; index < VISUAL_BAND_COUNT; index += 1) {
    const band = 0.025 + Math.sin(time / 1_200 + index * 0.58) * 0.012 + pulse * 0.025;
    bands[index] = band;
    bandEnvelopes[index] = band * 0.8;
    bandPeaks[index] = band;
  }

  return {
    ...silent,
    rms: 0.04 + pulse * 0.04,
    bass: 0.08 + pulse * 0.08,
    mid: 0.05,
    treble: 0.04,
    beatPulse: pulse * 0.08,
    energy: 0.08 + pulse * 0.08,
    spectralFlux: pulse * 0.06,
    spectralFlatness: 0.18 + pulse * 0.08,
    spectralRolloff: 0.32 + pulse * 0.08,
    dynamicRange: 0.08 + pulse * 0.06,
    onsetPulse: pulse * 0.06,
    bassPulse: pulse * 0.08,
    midPulse: pulse * 0.04,
    treblePulse: pulse * 0.03,
    bands,
    bandEnvelopes,
    bandPeaks,
    isSilent: true
  };
}

interface DirectedFrame {
  cameraX: number;
  cameraY: number;
  cameraZ: number;
  exposure: number;
  bloomStrength: number;
  bloomRadius: number;
  afterimageDamp: number;
  fogDensity: number;
}

class SceneDirector {
  private cameraX = 0;
  private cameraY = 0;
  private cameraZ = 10.8;

  reset(): void {
    this.cameraX = 0;
    this.cameraY = 0;
    this.cameraZ = 10.8;
  }

  update(time: number, features: AudioFeatures, deltaMs: number): DirectedFrame {
    const delta = Math.min(90, Math.max(0, deltaMs));
    const alpha = 1 - Math.exp(-delta / 140);
    const cameraDrift = Math.sin(time * 0.00012) * 0.14;
    const targetX = cameraDrift + (features.centroid - 0.5) * 0.22 + features.spectralFlux * 0.1;
    const targetY = Math.cos(time * 0.0001) * 0.1 + features.bass * 0.08 + features.dynamicRange * 0.06;
    const targetZ = 10.82 - features.energy * 0.34 + features.onsetPulse * 0.18;

    this.cameraX = lerp(this.cameraX, targetX, alpha);
    this.cameraY = lerp(this.cameraY, targetY, alpha);
    this.cameraZ = lerp(this.cameraZ, targetZ, alpha);

    return {
      cameraX: this.cameraX,
      cameraY: this.cameraY,
      cameraZ: this.cameraZ,
      exposure: 0.92 + Math.min(0.44, features.energy * 0.3 + features.onsetPulse * 0.28 + features.spectralRolloff * 0.06),
      bloomStrength: 0.56 + Math.min(0.92, features.energy * 0.58 + features.onsetPulse * 0.62 + features.spectralFlux * 0.34),
      bloomRadius: 0.42 + Math.min(0.34, features.treblePulse * 0.18 + features.spectralFlatness * 0.08 + features.spectralRolloff * 0.1),
      afterimageDamp: clamp(0.84 + features.energy * 0.07 + features.dynamicRange * 0.05 - features.onsetPulse * 0.03, 0.82, 0.94),
      fogDensity: 0.029 + features.energy * 0.012 + features.spectralFlatness * 0.006
    };
  }
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * clamp(alpha);
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}
