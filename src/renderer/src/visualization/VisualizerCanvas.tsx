import { useEffect, useRef, type MutableRefObject } from 'react';
import type { AudioFeatures } from '../audio/types';
import type { PaletteId, PresetId } from './types';
import { VisualizerRuntime } from './runtime';

interface VisualizerCanvasProps {
  featuresRef: MutableRefObject<AudioFeatures>;
  paletteId: PaletteId;
  presetId: PresetId;
  running: boolean;
}

export function VisualizerCanvas({ featuresRef, paletteId, presetId, running }: VisualizerCanvasProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runtimeRef = useRef<VisualizerRuntime | null>(null);
  const initialOptionsRef = useRef({ featuresRef, paletteId, presetId, running });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const runtime = new VisualizerRuntime(canvas, {
      featuresRef: initialOptionsRef.current.featuresRef,
      paletteId: initialOptionsRef.current.paletteId,
      presetId: initialOptionsRef.current.presetId,
      running: initialOptionsRef.current.running
    });
    runtimeRef.current = runtime;

    return () => {
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, []);

  useEffect(() => {
    runtimeRef.current?.setRunning(running);
  }, [running]);

  useEffect(() => {
    runtimeRef.current?.setPaletteId(paletteId);
  }, [paletteId]);

  useEffect(() => {
    runtimeRef.current?.setPresetId(presetId);
  }, [presetId]);

  useEffect(() => {
    runtimeRef.current?.setFeaturesRef(featuresRef);
  }, [featuresRef]);

  return <canvas aria-label="Audio visualizer canvas" className="visualizer-canvas" ref={canvasRef} />;
}
