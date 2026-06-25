import { useEffect, useRef, type MutableRefObject } from 'react';
import * as THREE from 'three';
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
      alpha: true,
      antialias: true,
      canvas,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    const camera = new THREE.PerspectiveCamera(54, 1, 0.1, 100);
    camera.position.set(0, 0, 12);

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);

    const resize = (): void => {
      const width = canvas.clientWidth || window.innerWidth;
      const height = canvas.clientHeight || window.innerHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      presetRef.current?.resize({ width, height });
    };

    const swapPreset = (nextPresetId: PresetId, nextPaletteId: PaletteId): void => {
      presetRef.current?.dispose();
      presetRef.current = createPreset(nextPresetId, getPalette(nextPaletteId));
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
      presetRef.current?.update(features, deltaMs);
      renderer.render(scene, camera);
      rafId = window.requestAnimationFrame(animate);
    };

    window.addEventListener('resize', resize);
    rafId = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
      presetRef.current?.dispose();
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
