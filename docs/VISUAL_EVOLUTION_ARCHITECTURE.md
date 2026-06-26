# Visual Evolution Architecture

Shadow Spectrum now treats the visualizer as one long-lived procedural instrument instead of a React effect that rebuilds WebGL state on control changes.

## Runtime Lifecycle

`VisualizerCanvas` creates one `VisualizerRuntime` for the mounted canvas. The runtime owns the WebGL renderer, scene, camera, bloom composer, render targets, audio texture, feedback shader, preset instances, and animation loop. React prop changes call runtime setters for running state, palette, preset, and audio-feature refs.

Start/stop and palette changes do not recreate the renderer or reset procedural time. Preset changes create a new preset instance with a derived seed and crossfade it against the outgoing instance while preserving feedback history.

## Seeded Evolution

Each app session receives a crypto seed unless `?visualSeed=...` is present. Preset instances, auto-cycle selection, particles, feedback behavior, and the demo source derive child seeds from that session seed.

`VisualEvolutionController` owns persistent visual DNA: coordinate mode, internal mode, symmetry, flow, domain warp, center/composition, zoom, feedback transform, color phase, density, brightness, and topology mix. Randomness is only used when creating state, scheduling changes, or mutating targets. Per-frame updates interpolate toward those targets with time-based exponential smoothing.

Evolution uses three timescales:

- Fast: transient pulses from onset, bass, mid, and treble features.
- Medium: 2-12 second target changes for flow, center, warp, density, and symmetry.
- Macro: 15-90 second mode, topology, palette, and feedback mutations, biased toward novelty/onset-density boundaries.

## Audio Features

The browser and native paths preserve the existing 24-band analysis and extend it with timestamped features, adaptive band normalization, band transients, slow bands, novelty, onset density, and loudness trend. Histories are time-windowed so 30 Hz native analysis and 60/120 Hz browser rendering stay behaviorally compatible.

`AudioSpectrumTexture` uploads the current 24 bands, envelopes, peaks, transients, slow bands, and rolling history to a small floating-point `DataTexture`. Shaders sample that texture spatially so lows can bend large-scale structure, mids can affect folds/density, and highs can sharpen sparks and edges.

## Feedback Pipeline

The old `AfterimagePass` dependency has been replaced by a custom ping-pong feedback pass:

1. Render active/outgoing preset instances to a current-frame target.
2. Render a feedback quad that samples the previous feedback target and the current frame.
3. Apply scale, rotation, translation, displacement, decay, color shift, and transition fade.
4. Swap feedback targets.
5. Render the feedback texture through bloom and final compositing.

Decay, clamping, and transition fade prevent runaway brightness while still allowing trails, echoes, tunnels, folds, and persistent smears.

## Presets And Transitions

The public preset IDs remain `vortex-eye`, `electric-fold`, `liquid-veil`, and `plasma-bowl`. Each preset is now a family driven by the shared DNA and audio texture rather than a fixed shader equation. Palette uniforms are the primary color source across all preset families, including Plasma Bowl particles.

Auto-cycle uses seeded weighted selection instead of sequential order. It avoids immediate repeats, prefers musical boundaries from novelty/onset density/spectral flux, and falls back after a randomized maximum interval.

## Test Strategy

Tests cover deterministic seeds, non-repeating evolution, cooldown scheduling, frame-rate-independent interpolation, time-based audio histories, adaptive normalization, spectrum texture layout, demo-source scheduling, preset factory behavior, renderer lifecycle setters, and resource disposal expectations.
