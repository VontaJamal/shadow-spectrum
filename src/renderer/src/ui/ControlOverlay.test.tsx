import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { VisualizerSettings } from '../App';
import { ControlOverlay } from './ControlOverlay';

const settings: VisualizerSettings = {
  sourceMode: 'synthetic-demo',
  presetId: 'vortex-eye',
  paletteId: 'aurora',
  sensitivity: 1.1,
  smoothing: 0.78,
  autoCycle: false,
  fullscreen: false
};

describe('ControlOverlay', () => {
  it('renders the Shadow Spectrum brand and omits the retired Spectra Drift name', () => {
    render(
      <ControlOverlay
        isRunning={false}
        message="Ready"
        onSettingsChange={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onToggleFullscreen={vi.fn()}
        settings={settings}
        status="idle"
      />
    );

    expect(screen.getByText('Shadow Spectrum')).toBeVisible();
    expect(screen.queryByText('Spectra Drift')).not.toBeInTheDocument();
  });

  it('starts and stops capture from the primary button', async () => {
    const user = userEvent.setup();
    const onStart = vi.fn();
    const onStop = vi.fn();

    const { rerender } = render(
      <ControlOverlay
        isRunning={false}
        message="Ready"
        onSettingsChange={vi.fn()}
        onStart={onStart}
        onStop={onStop}
        onToggleFullscreen={vi.fn()}
        settings={settings}
        status="idle"
      />
    );

    await user.click(screen.getByRole('button', { name: /start capture/i }));
    expect(onStart).toHaveBeenCalledTimes(1);

    rerender(
      <ControlOverlay
        isRunning
        message="Active"
        onSettingsChange={vi.fn()}
        onStart={onStart}
        onStop={onStop}
        onToggleFullscreen={vi.fn()}
        settings={settings}
        status="active"
      />
    );

    await user.click(screen.getByRole('button', { name: /stop capture/i }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('persists source and preset changes through the settings callback', async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();

    render(
      <ControlOverlay
        isRunning={false}
        message="Ready"
        onSettingsChange={onSettingsChange}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onToggleFullscreen={vi.fn()}
        settings={settings}
        status="idle"
      />
    );

    await user.selectOptions(screen.getByLabelText(/source/i), 'microphone');
    await user.selectOptions(screen.getByLabelText(/preset/i), 'liquid-veil');

    expect(onSettingsChange).toHaveBeenCalledWith({ sourceMode: 'microphone' });
    expect(onSettingsChange).toHaveBeenCalledWith({ presetId: 'liquid-veil' });
  });

  it('presents automatic preset changes in plain language', async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();

    render(
      <ControlOverlay
        isRunning={false}
        message="Ready"
        onSettingsChange={onSettingsChange}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onToggleFullscreen={vi.fn()}
        settings={settings}
        status="idle"
      />
    );

    const changeVisualsToggle = screen.getByLabelText(/change visuals automatically/i);

    expect(screen.getByText('Change visuals')).toBeVisible();
    expect(screen.queryByText('Auto-cycle')).not.toBeInTheDocument();

    await user.click(changeVisualsToggle);

    expect(onSettingsChange).toHaveBeenCalledWith({ autoCycle: true });
  });

  it('marks the overlay as running so controls can recede and reveal on focus or hover', () => {
    const { container } = render(
      <ControlOverlay
        isRunning
        message="Active"
        onSettingsChange={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onToggleFullscreen={vi.fn()}
        settings={settings}
        status="active"
      />
    );

    expect(container.querySelector('.control-overlay')).toHaveAttribute('data-running', 'true');
    expect(screen.getByRole('button', { name: /stop capture/i })).toBeVisible();
    expect(screen.getByLabelText(/preset/i)).toBeVisible();
  });
});
