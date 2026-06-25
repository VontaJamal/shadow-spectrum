# Spectra Drift

A macOS-first personal desktop visualizer for music already playing on your computer. It does not log in to Spotify, control Spotify, or read Spotify's protected stream. Instead, it reacts to live audio that you choose to capture locally.

## What it does

- Captures desktop audio in Electron where the OS and Electron runtime allow loopback capture.
- Falls back to microphone or synthetic demo audio.
- Converts audio into in-memory Web Audio features.
- Renders full-screen Three.js visual presets inspired by modern audio art.
- Stores only local UI preferences.

## What it does not do

- No Spotify OAuth.
- No Spotify Web Playback SDK player.
- No Spotify track metadata or album art.
- No recording, uploading, exporting, or storing audio.

## Development

```bash
npm install
npm run dev
```

The app starts in synthetic demo mode so the visualizer works before audio permissions are granted.

For browser-only preview of the renderer:

```bash
npm run dev:renderer
```

## macOS audio capture notes

Electron's built-in loopback capture is currently Windows-only. On macOS, use microphone mode with speakers, demo mode, or route Spotify through a virtual audio device such as BlackHole and select that device as an input.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

The Playwright Electron smoke test is available with:

```bash
npm run test:e2e
```

System audio permissions are not covered by CI because CI cannot grant macOS media permissions.
