import { describe, expect, it } from 'vitest';
import { GenerativeDemoSequencer } from './sources';

describe('GenerativeDemoSequencer', () => {
  it('is deterministic when supplied a pinned seed', () => {
    const first = new GenerativeDemoSequencer({ seed: 1234 });
    const second = new GenerativeDemoSequencer({ seed: 1234 });
    const firstFrames = [];
    const secondFrames = [];

    for (let index = 0; index < 180; index += 1) {
      const time = index * 0.17;
      firstFrames.push(first.sample(time));
      secondFrames.push(second.sample(time));
    }

    expect(firstFrames).toEqual(secondFrames);
  });

  it('schedules varied bass, mid, high, rest, and phrase events without a short loop', () => {
    const sequencer = new GenerativeDemoSequencer({ seed: 991 });
    const phraseIndexes = new Set<number>();
    let bassEvents = 0;
    let midEvents = 0;
    let highEvents = 0;
    let restFrames = 0;
    const gains: string[] = [];

    for (let index = 0; index < 360; index += 1) {
      const frame = sequencer.sample(index * 0.12);
      phraseIndexes.add(frame.phraseIndex);
      if (frame.bassGain > 0.34) bassEvents += 1;
      if (frame.midGain > 0.12) midEvents += 1;
      if (frame.highGain > 0.08 || frame.noiseGain > 0.08) highEvents += 1;
      if (frame.restAmount > 0) restFrames += 1;
      gains.push(`${frame.bassGain.toFixed(3)}:${frame.midGain.toFixed(3)}:${frame.highGain.toFixed(3)}`);
    }

    expect(phraseIndexes.size).toBeGreaterThan(3);
    expect(bassEvents).toBeGreaterThan(10);
    expect(midEvents).toBeGreaterThan(10);
    expect(highEvents).toBeGreaterThan(10);
    expect(restFrames).toBeGreaterThan(0);
    expect(gains.slice(0, 24)).not.toEqual(gains.slice(24, 48));
  });
});
