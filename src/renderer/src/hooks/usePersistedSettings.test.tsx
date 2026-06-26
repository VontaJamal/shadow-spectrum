import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePersistedSettings } from './usePersistedSettings';
import { normalizePresetId } from '../visualization/options';

interface TestSettings {
  presetId: string;
  autoCycle: boolean;
}

const defaultSettings: TestSettings = {
  presetId: 'vortex-eye',
  autoCycle: false
};

function normalizeSettings(settings: TestSettings): TestSettings {
  return {
    ...settings,
    presetId: normalizePresetId(settings.presetId)
  };
}

function Harness(): JSX.Element {
  const [settings] = usePersistedSettings<TestSettings>('test-visualizer-settings', defaultSettings, normalizeSettings);
  return (
    <output data-testid="settings">
      {settings.presetId}:{String(settings.autoCycle)}
    </output>
  );
}

describe('usePersistedSettings', () => {
  it('normalizes stale stored preset ids while preserving other stored settings', () => {
    window.localStorage.setItem(
      'test-visualizer-settings',
      JSON.stringify({ presetId: 'particle-field', autoCycle: true })
    );

    render(<Harness />);

    expect(screen.getByTestId('settings')).toHaveTextContent('vortex-eye:true');
    expect(JSON.parse(window.localStorage.getItem('test-visualizer-settings') ?? '{}')).toEqual({
      presetId: 'vortex-eye',
      autoCycle: true
    });
  });
});
