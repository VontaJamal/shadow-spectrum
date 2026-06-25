import { useEffect, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { AudioFeatures } from '../audio/types';
import { createSilentAudioFeatures } from '../audio/featureExtractor';
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
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.72, 0.58, 0.08);
    const composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    composer.addPass(bloomPass);

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
      const exposureLift = Math.min(0.32, features.rms * 0.24 + features.beatPulse * 0.18);
      const cameraDrift = Math.sin(time * 0.00012) * 0.14;

      camera.position.x = cameraDrift + features.centroid * 0.18;
      camera.position.y = Math.cos(time * 0.0001) * 0.1 + features.bass * 0.08;
      camera.lookAt(0, 0, 0);
      renderer.toneMappingExposure = 0.94 + exposureLift;
      bloomPass.strength = 0.62 + Math.min(0.72, features.rms * 0.46 + features.beatPulse * 0.62);
      bloomPass.radius = 0.46 + Math.min(0.28, features.treble * 0.18 + features.centroid * 0.1);

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
  return {
    ...silent,
    rms: 0.04 + pulse * 0.04,
    bass: 0.08 + pulse * 0.08,
    mid: 0.05,
    treble: 0.04,
    beatPulse: pulse * 0.08,
    isSilent: true
  };
}
