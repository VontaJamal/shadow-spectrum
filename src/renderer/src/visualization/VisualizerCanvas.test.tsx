import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MutableRefObject } from 'react';
import { createSilentAudioFeatures } from '../audio/featureExtractor';
import type { AudioFeatures } from '../audio/types';
import { VisualizerCanvas } from './VisualizerCanvas';
import { VisualizerRuntime } from './runtime';

const runtimeInstances: Array<{
  dispose: ReturnType<typeof vi.fn>;
  setFeaturesRef: ReturnType<typeof vi.fn>;
  setPaletteId: ReturnType<typeof vi.fn>;
  setPresetId: ReturnType<typeof vi.fn>;
  setRunning: ReturnType<typeof vi.fn>;
}> = [];

vi.mock('./runtime', () => ({
  VisualizerRuntime: vi.fn().mockImplementation(() => {
    const instance = {
      dispose: vi.fn(),
      setFeaturesRef: vi.fn(),
      setPaletteId: vi.fn(),
      setPresetId: vi.fn(),
      setRunning: vi.fn()
    };
    runtimeInstances.push(instance);
    return instance;
  })
}));

describe('VisualizerCanvas lifecycle', () => {
  beforeEach(() => {
    runtimeInstances.length = 0;
    vi.mocked(VisualizerRuntime).mockClear();
  });

  it('keeps one runtime across running, palette, and preset updates', () => {
    const featuresRef = { current: createSilentAudioFeatures() } as MutableRefObject<AudioFeatures>;
    const { rerender, unmount } = render(
      <VisualizerCanvas featuresRef={featuresRef} paletteId="aurora" presetId="vortex-eye" running={false} />
    );

    rerender(<VisualizerCanvas featuresRef={featuresRef} paletteId="ember" presetId="vortex-eye" running />);
    rerender(<VisualizerCanvas featuresRef={featuresRef} paletteId="mono-gold" presetId="plasma-bowl" running />);

    expect(VisualizerRuntime).toHaveBeenCalledTimes(1);
    expect(runtimeInstances[0].setRunning).toHaveBeenCalledWith(true);
    expect(runtimeInstances[0].setPaletteId).toHaveBeenCalledWith('ember');
    expect(runtimeInstances[0].setPaletteId).toHaveBeenCalledWith('mono-gold');
    expect(runtimeInstances[0].setPresetId).toHaveBeenCalledWith('plasma-bowl');

    unmount();
    expect(runtimeInstances[0].dispose).toHaveBeenCalledTimes(1);
  });
});
