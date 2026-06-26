import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioEngine } from './audio/AudioEngine';
import { createSilentAudioFeatures } from './audio/featureExtractor';
import type { AudioFeatures, AudioSourceKind, AudioSourceStatus } from './audio/types';
import { ControlOverlay } from './ui/ControlOverlay';
import { VisualizerCanvas } from './visualization/VisualizerCanvas';
import { presets } from './visualization/options';
import type { PaletteId, PresetId } from './visualization/types';
import { usePersistedSettings } from './hooks/usePersistedSettings';
import './styles.css';

export interface VisualizerSettings {
  sourceMode: AudioSourceKind;
  presetId: PresetId;
  paletteId: PaletteId;
  sensitivity: number;
  smoothing: number;
  autoCycle: boolean;
  fullscreen: boolean;
}

const defaultSettings: VisualizerSettings = {
  sourceMode: 'synthetic-demo',
  presetId: 'particle-field',
  paletteId: 'aurora',
  sensitivity: 1.1,
  smoothing: 0.78,
  autoCycle: false,
  fullscreen: false
};

const autoCycleArmMs = 45_000;
const autoCycleFallbackMs = 60_000;

export function App(): JSX.Element {
  const [settings, setSettings] = usePersistedSettings<VisualizerSettings>('spectra-drift-settings', defaultSettings);
  const [status, setStatus] = useState<AudioSourceStatus>('idle');
  const [message, setMessage] = useState('Demo source ready');
  const [isRunning, setIsRunning] = useState(false);
  const featuresRef = useRef<AudioFeatures>(createSilentAudioFeatures());
  const engineRef = useRef<AudioEngine | null>(null);

  const engine = useMemo(() => {
    const created = new AudioEngine({
      onFeatures: (features) => {
        featuresRef.current = features;
      },
      onStatus: (nextStatus, nextMessage) => {
        setStatus(nextStatus);
        setMessage(nextMessage);
        setIsRunning(nextStatus === 'active' || nextStatus === 'silent');
      }
    });

    engineRef.current = created;
    return created;
  }, []);

  useEffect(() => {
    engine.updateAnalysisOptions({
      sensitivity: settings.sensitivity,
      smoothing: settings.smoothing
    });
  }, [engine, settings.sensitivity, settings.smoothing]);

  useEffect(() => {
    return () => {
      engineRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!settings.autoCycle || !isRunning) {
      return undefined;
    }

    let cycleStartedAt = performance.now();
    const intervalId = window.setInterval(() => {
      const elapsed = performance.now() - cycleStartedAt;
      const shouldAdvance = elapsed >= autoCycleArmMs && (featuresRef.current.onsetPulse >= 0.35 || elapsed >= autoCycleFallbackMs);

      if (!shouldAdvance) {
        return;
      }

      setSettings((current) => {
        const currentIndex = presets.findIndex((preset) => preset.id === current.presetId);
        const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % presets.length : 0;
        return {
          ...current,
          presetId: presets[nextIndex].id
        };
      });
      cycleStartedAt = performance.now();
    }, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isRunning, setSettings, settings.autoCycle]);

  const start = useCallback(async () => {
    try {
      await engine.start(settings.sourceMode);
    } catch {
      setIsRunning(false);
    }
  }, [engine, settings.sourceMode]);

  const stop = useCallback(() => {
    engine.stop();
    featuresRef.current = createSilentAudioFeatures();
  }, [engine]);

  const toggleFullscreen = useCallback(async () => {
    const next = await window.visualizerApi?.toggleFullscreen?.();
    setSettings((current) => ({
      ...current,
      fullscreen: typeof next === 'boolean' ? next : !current.fullscreen
    }));
  }, [setSettings]);

  const updateSettings = useCallback(
    (patch: Partial<VisualizerSettings>) => {
      setSettings((current) => ({ ...current, ...patch }));
    },
    [setSettings]
  );

  return (
    <main className="app-shell">
      <VisualizerCanvas
        featuresRef={featuresRef}
        paletteId={settings.paletteId}
        presetId={settings.presetId}
        running={isRunning}
      />
      <ControlOverlay
        isRunning={isRunning}
        message={message}
        onSettingsChange={updateSettings}
        onStart={start}
        onStop={stop}
        onToggleFullscreen={toggleFullscreen}
        settings={settings}
        status={status}
      />
    </main>
  );
}
