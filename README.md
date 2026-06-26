# Shadow Spectrum

A macOS-first personal desktop visualizer for music already playing on your computer. It does not log in to Spotify, control Spotify, or read Spotify's protected stream. Instead, it reacts to live audio that you choose to capture locally.

## What it does

- Captures system audio on macOS through a native ScreenCaptureKit helper.
- Keeps the Electron loopback path available for Windows.
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

The System source uses Apple's ScreenCaptureKit framework through a small Swift helper. macOS may ask for Screen Recording permission the first time system audio capture starts. Audio is analyzed in memory and streamed to the renderer as visualizer features; it is not recorded or saved.

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
