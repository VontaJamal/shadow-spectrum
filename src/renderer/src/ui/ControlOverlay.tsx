import { Maximize2, Pause, Play } from 'lucide-react';
import type { VisualizerSettings } from '../App';
import type { AudioSourceKind, AudioSourceStatus } from '../audio/types';
import { palettes, presets } from '../visualization/options';
import type { PaletteId, PresetId } from '../visualization/types';

interface ControlOverlayProps {
  isRunning: boolean;
  message: string;
  settings: VisualizerSettings;
  status: AudioSourceStatus;
  onSettingsChange: (patch: Partial<VisualizerSettings>) => void;
  onStart: () => void;
  onStop: () => void;
  onToggleFullscreen: () => void;
}

const sourceOptions: Array<{ id: AudioSourceKind; label: string }> = [
  { id: 'synthetic-demo', label: 'Demo' },
  { id: 'desktop-loopback', label: 'System' },
  { id: 'microphone', label: 'Mic' }
];

export function ControlOverlay({
  isRunning,
  message,
  onSettingsChange,
  onStart,
  onStop,
  onToggleFullscreen,
  settings,
  status
}: ControlOverlayProps): JSX.Element {
  const statusTone =
    status === 'permission-denied' || status === 'unsupported' || status === 'error'
      ? status
      : status === 'active'
        ? 'active'
        : status;

  return (
    <div className="control-overlay">
      <div className="top-strip">
        <div className="brand-lockup">
          <strong>Spectra Drift</strong>
          <span>Local audio visualizer</span>
        </div>
        <div className="status-cluster">
          <div className="status-pill" data-status={statusTone}>
            <span className="status-dot" />
            <span className="status-text">{message}</span>
          </div>
          <button
            aria-label="Toggle fullscreen"
            className="icon-button"
            onClick={onToggleFullscreen}
            title="Toggle fullscreen"
            type="button"
          >
            <Maximize2 size={18} />
          </button>
        </div>
      </div>

      <div aria-hidden="true" className="stage-vignette" />

      <div className="bottom-strip">
        <button
          aria-label={isRunning ? 'Stop capture' : 'Start capture'}
          className="primary-button"
          onClick={isRunning ? onStop : onStart}
          type="button"
        >
          {isRunning ? <Pause size={18} /> : <Play size={18} />}
          {isRunning ? 'Stop' : 'Start'}
        </button>

        <section aria-label="Visualizer controls" className="control-surface">
          <div className="control-grid">
            <label className="control-field">
              <span>Source</span>
              <select
                aria-label="Source"
                onChange={(event) => onSettingsChange({ sourceMode: event.target.value as AudioSourceKind })}
                value={settings.sourceMode}
              >
                {sourceOptions.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="control-field">
              <span>Preset</span>
              <select
                aria-label="Preset"
                onChange={(event) => onSettingsChange({ presetId: event.target.value as PresetId })}
                value={settings.presetId}
              >
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="control-field">
              <span>Palette</span>
              <select
                aria-label="Palette"
                onChange={(event) => onSettingsChange({ paletteId: event.target.value as PaletteId })}
                value={settings.paletteId}
              >
                {palettes.map((palette) => (
                  <option key={palette.id} value={palette.id}>
                    {palette.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="control-field">
              <span>Smoothing</span>
              <span className="slider">
                <input
                  aria-label="Smoothing"
                  max="0.95"
                  min="0.1"
                  onChange={(event) => onSettingsChange({ smoothing: Number(event.target.value) })}
                  step="0.01"
                  type="range"
                  value={settings.smoothing}
                />
                <span className="slider-value">{settings.smoothing.toFixed(2)}</span>
              </span>
            </label>

            <label className="control-field">
              <span>Sensitivity</span>
              <span className="slider">
                <input
                  aria-label="Sensitivity"
                  max="2"
                  min="0.4"
                  onChange={(event) => onSettingsChange({ sensitivity: Number(event.target.value) })}
                  step="0.05"
                  type="range"
                  value={settings.sensitivity}
                />
                <span className="slider-value">{settings.sensitivity.toFixed(2)}</span>
              </span>
            </label>
          </div>
        </section>
      </div>
    </div>
  );
}
