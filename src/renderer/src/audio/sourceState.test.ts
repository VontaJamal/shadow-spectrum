import { describe, expect, it } from 'vitest';
import { isDesktopLoopbackSupported, transitionSourceStatus, withCaptureTimeout } from './sources';

describe('transitionSourceStatus', () => {
  it('moves idle sources into requesting state', () => {
    expect(transitionSourceStatus('idle', 'request')).toBe('requesting');
  });

  it('marks a started stream active', () => {
    expect(transitionSourceStatus('requesting', 'stream-started')).toBe('active');
  });

  it('preserves permission denial as a terminal capture failure', () => {
    expect(transitionSourceStatus('requesting', 'permission-denied')).toBe('permission-denied');
  });

  it('marks active streams silent when no energy arrives', () => {
    expect(transitionSourceStatus('active', 'silence-detected')).toBe('silent');
  });

  it('marks stopped sources as stopped', () => {
    expect(transitionSourceStatus('silent', 'stop')).toBe('stopped');
  });

  it('marks unsupported sources explicitly', () => {
    expect(transitionSourceStatus('requesting', 'unsupported')).toBe('unsupported');
  });

  it('treats Electron desktop loopback as Windows-only', () => {
    expect(isDesktopLoopbackSupported('win32')).toBe(true);
    expect(isDesktopLoopbackSupported('darwin')).toBe(false);
    expect(isDesktopLoopbackSupported('MacIntel')).toBe(false);
  });

  it('times out unresolved capture requests', async () => {
    await expect(withCaptureTimeout(new Promise(() => undefined), 1)).rejects.toThrow('Capture request timed out');
  });
});
