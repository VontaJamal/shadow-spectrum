import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { AudioFeatures } from '../audio/types';
import { VISUAL_BAND_COUNT, createSilentAudioFeatures } from '../audio/featureExtractor';
import { AudioSpectrumTexture } from './audioTexture';
import { VisualEvolutionController } from './evolution';
import { getPalette } from './options';
import { createPreset } from './presets';
import { createSessionSeed, deriveSeed } from './prng';
import type {
  Palette,
  PaletteId,
  PresetId,
  Size,
  VisualEvolutionFrame,
  VisualFrameContext,
  VisualTransitionFrame,
  VisualizerPreset
} from './types';

interface AudioFeatureRef {
  current: AudioFeatures;
}

interface VisualizerRuntimeOptions {
  featuresRef: AudioFeatureRef;
  paletteId: PaletteId;
  presetId: PresetId;
  running: boolean;
}

interface PresetInstance {
  preset: VisualizerPreset;
  controller: VisualEvolutionController;
  id: PresetId;
}

interface ActiveTransition {
  outgoing: PresetInstance | null;
  startedAt: number;
  durationMs: number;
}

export interface VisualizerRuntimeDiagnostics {
  rendererGeneration: number;
  activePresetId: PresetId;
  outgoingPresetId: PresetId | null;
  running: boolean;
}

export class VisualizerRuntime {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  private readonly ambient = new THREE.AmbientLight(0xffffff, 0.55);
  private readonly currentFrameTarget = createRenderTarget(1, 1);
  private feedbackRead = createRenderTarget(1, 1);
  private feedbackWrite = createRenderTarget(1, 1);
  private readonly feedbackScene = new THREE.Scene();
  private readonly finalScene = new THREE.Scene();
  private readonly screenCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly feedbackMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    fragmentShader: feedbackFragmentShader,
    uniforms: createFeedbackUniforms(),
    vertexShader: screenVertexShader
  });
  private readonly finalMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    fragmentShader: finalFragmentShader,
    uniforms: {
      tMap: { value: this.feedbackRead.texture }
    },
    vertexShader: screenVertexShader
  });
  private readonly screenGeometry = new THREE.PlaneGeometry(2, 2);
  private readonly feedbackQuad = new THREE.Mesh(this.screenGeometry, this.feedbackMaterial);
  private readonly finalQuad = new THREE.Mesh(this.screenGeometry, this.finalMaterial);
  private readonly renderPass = new RenderPass(this.finalScene, this.screenCamera);
  private readonly bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.72, 0.58, 0.08);
  private readonly composer: EffectComposer;
  private readonly director = new SceneDirector();
  private readonly spectrum = new AudioSpectrumTexture();
  private readonly sessionSeed = createSessionSeed();
  private readonly rendererGeneration = 1;
  private featuresRef: AudioFeatureRef;
  private paletteId: PaletteId;
  private palette: Palette;
  private running: boolean;
  private active: PresetInstance;
  private transition: ActiveTransition = { outgoing: null, startedAt: 0, durationMs: 1 };
  private size: Size = { width: 1, height: 1 };
  private instanceCount = 0;
  private lastTime = performance.now();
  private rafId = 0;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement, options: VisualizerRuntimeOptions) {
    this.featuresRef = options.featuresRef;
    this.paletteId = options.paletteId;
    this.palette = getPalette(options.paletteId);
    this.running = options.running;

    this.renderer = new THREE.WebGLRenderer({
      alpha: false,
      antialias: true,
      canvas,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.96;
    this.renderer.setClearColor(this.palette.background, 1);

    this.scene.add(this.ambient);
    this.applyScenePalette(this.palette);
    this.camera.position.set(0, 0, 10.8);
    this.feedbackScene.add(this.feedbackQuad);
    this.finalScene.add(this.finalQuad);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloomPass);

    this.active = this.createInstance(options.presetId);
    this.resize = this.resize.bind(this);
    this.animate = this.animate.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
    this.rafId = window.requestAnimationFrame(this.animate);
  }

  setRunning(running: boolean): void {
    this.running = running;
  }

  setFeaturesRef(featuresRef: AudioFeatureRef): void {
    this.featuresRef = featuresRef;
  }

  setPaletteId(paletteId: PaletteId): void {
    if (this.paletteId === paletteId) {
      return;
    }

    this.paletteId = paletteId;
    this.palette = getPalette(paletteId);
    this.applyScenePalette(this.palette);
    this.active.preset.setPalette(this.palette);
    this.transition.outgoing?.preset.setPalette(this.palette);
  }

  setPresetId(presetId: PresetId): void {
    if (this.active.id === presetId) {
      return;
    }

    this.transition.outgoing = this.active;
    this.transition.startedAt = performance.now();
    this.transition.durationMs = 3_000 + (deriveSeed(this.sessionSeed, `${this.instanceCount}:transition`) % 4_000);
    this.active = this.createInstance(presetId);
    this.active.preset.resize(this.size);
  }

  getDiagnostics(): VisualizerRuntimeDiagnostics {
    return {
      rendererGeneration: this.rendererGeneration,
      activePresetId: this.active.id,
      outgoingPresetId: this.transition.outgoing?.id ?? null,
      running: this.running
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    window.cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.resize);
    this.active.preset.dispose();
    this.transition.outgoing?.preset.dispose();
    this.currentFrameTarget.dispose();
    this.feedbackRead.dispose();
    this.feedbackWrite.dispose();
    this.spectrum.dispose();
    this.feedbackMaterial.dispose();
    this.finalMaterial.dispose();
    this.screenGeometry.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.scene.clear();
    this.feedbackScene.clear();
    this.finalScene.clear();
  }

  private get pixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, 1.75);
  }

  private createInstance(id: PresetId): PresetInstance {
    const seed = deriveSeed(this.sessionSeed, `${id}:${this.instanceCount}`);
    this.instanceCount += 1;
    const preset = createPreset(id, this.palette, { seed });
    preset.init(this.scene);
    preset.resize(this.size);
    return {
      preset,
      controller: new VisualEvolutionController({ seed, presetId: id }),
      id
    };
  }

  private resize(): void {
    const width = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    const pixelWidth = Math.max(1, Math.floor(width * this.pixelRatio));
    const pixelHeight = Math.max(1, Math.floor(height * this.pixelRatio));
    this.size = { width, height };
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(width, height);
    this.bloomPass.setSize(width, height);
    this.currentFrameTarget.setSize(pixelWidth, pixelHeight);
    this.feedbackRead.setSize(pixelWidth, pixelHeight);
    this.feedbackWrite.setSize(pixelWidth, pixelHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.active.preset.resize(this.size);
    this.transition.outgoing?.preset.resize(this.size);
  }

  private animate(time: number): void {
    if (this.disposed) {
      return;
    }

    const deltaMs = Math.min(120, Math.max(0, time - this.lastTime));
    this.lastTime = time;
    this.renderFrame(time, deltaMs);
    this.rafId = window.requestAnimationFrame(this.animate);
  }

  private renderFrame(time: number, deltaMs: number): void {
    const features = this.running ? this.featuresRef.current : createIdleFeatures(time);
    this.spectrum.update(features);
    const transitionFrame = this.createTransitionFrame(time);
    const activeEvolution = this.active.controller.update(features, deltaMs);
    const outgoingEvolution = this.transition.outgoing?.controller.update(features, deltaMs) ?? activeEvolution;
    this.director.update(this.camera, this.renderer, this.bloomPass, this.scene, features, activeEvolution, deltaMs);

    this.renderPresetInstance(this.active, activeEvolution, transitionFrame, features, deltaMs, time, transitionFrame.progress);
    if (this.transition.outgoing) {
      this.renderPresetInstance(
        this.transition.outgoing,
        outgoingEvolution,
        transitionFrame,
        features,
        deltaMs,
        time,
        1 - transitionFrame.progress
      );
    }

    this.renderer.setRenderTarget(this.currentFrameTarget);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);

    this.renderFeedback(activeEvolution, features, transitionFrame, time);
    this.finalMaterial.uniforms.tMap.value = this.feedbackRead.texture;
    this.renderer.setRenderTarget(null);
    this.composer.render();

    if (this.transition.outgoing && transitionFrame.progress >= 1) {
      this.transition.outgoing.preset.dispose();
      this.transition.outgoing = null;
    }
  }

  private renderPresetInstance(
    instance: PresetInstance,
    evolution: VisualEvolutionFrame,
    transition: VisualTransitionFrame,
    features: AudioFeatures,
    deltaMs: number,
    elapsedMs: number,
    opacity: number
  ): void {
    const context: VisualFrameContext = {
      features,
      spectrumTexture: this.spectrum.texture,
      evolution,
      transition,
      palette: this.palette,
      deltaMs,
      elapsedMs,
      opacity: smoothstep(opacity)
    };
    instance.preset.update(context);
  }

  private createTransitionFrame(time: number): VisualTransitionFrame {
    if (!this.transition.outgoing) {
      return {
        activePresetId: this.active.id,
        outgoingPresetId: null,
        progress: 1,
        durationMs: 1,
        feedbackFade: 0
      };
    }

    const elapsed = time - this.transition.startedAt;
    const progress = clamp(elapsed / this.transition.durationMs);
    return {
      activePresetId: this.active.id,
      outgoingPresetId: this.transition.outgoing.id,
      progress,
      durationMs: this.transition.durationMs,
      feedbackFade: (1 - progress) * 0.08
    };
  }

  private renderFeedback(evolution: VisualEvolutionFrame, features: AudioFeatures, transition: VisualTransitionFrame, time: number): void {
    const uniforms = this.feedbackMaterial.uniforms;
    uniforms.tPrevious.value = this.feedbackRead.texture;
    uniforms.tCurrent.value = this.currentFrameTarget.texture;
    uniforms.uTime.value = time * 0.001;
    uniforms.uDecay.value = clamp(evolution.dna.feedbackDecay - features.onsetPulse * 0.018, 0.82, 0.96);
    uniforms.uScale.value = clamp(evolution.dna.feedbackScale + features.bassPulse * 0.003, 0.975, 1.035);
    uniforms.uRotation.value = evolution.dna.feedbackRotation * 0.012 + features.spectralFlux * 0.002;
    uniforms.uTranslate.value.set(evolution.dna.feedbackTranslateX, evolution.dna.feedbackTranslateY);
    uniforms.uDisplacement.value = clamp(evolution.dna.feedbackDisplacement + features.treblePulse * 0.012, 0, 0.06);
    uniforms.uCurrentMix.value = clamp(0.46 + features.energy * 0.18 + features.onsetPulse * 0.14);
    uniforms.uFade.value = transition.feedbackFade;
    uniforms.uColorShift.value = evolution.dna.colorPhase;

    this.renderer.setRenderTarget(this.feedbackWrite);
    this.renderer.clear();
    this.renderer.render(this.feedbackScene, this.screenCamera);
    const nextRead = this.feedbackWrite;
    this.feedbackWrite = this.feedbackRead;
    this.feedbackRead = nextRead;
  }

  private applyScenePalette(palette: Palette): void {
    this.renderer?.setClearColor(palette.background, 1);
    this.scene.background = new THREE.Color(palette.background);
    this.scene.fog = new THREE.FogExp2(palette.fog, 0.035);
  }
}

class SceneDirector {
  private cameraX = 0;
  private cameraY = 0;
  private cameraZ = 10.8;

  update(
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    bloomPass: UnrealBloomPass,
    scene: THREE.Scene,
    features: AudioFeatures,
    evolution: VisualEvolutionFrame,
    deltaMs: number
  ): void {
    const delta = Math.min(120, Math.max(0, deltaMs));
    const alpha = 1 - Math.exp(-delta / 190);
    const dna = evolution.dna;
    const targetX = dna.compositionX * 0.32 + (features.centroid - 0.5) * 0.18 + features.spectralFlux * 0.08;
    const targetY = dna.compositionY * 0.26 + features.bass * 0.06 + features.dynamicRange * 0.04;
    const targetZ = 10.85 - features.energy * 0.32 + features.onsetPulse * 0.16 - (dna.zoom - 1) * 0.34;

    this.cameraX = lerp(this.cameraX, targetX, alpha);
    this.cameraY = lerp(this.cameraY, targetY, alpha);
    this.cameraZ = lerp(this.cameraZ, targetZ, alpha);
    camera.position.set(this.cameraX, this.cameraY, this.cameraZ);
    camera.lookAt(dna.centerX * 0.18, dna.centerY * 0.18, 0);
    renderer.toneMappingExposure = 0.9 + Math.min(0.5, features.energy * 0.28 + features.onsetPulse * 0.24 + evolution.macroEvent * 0.06);
    bloomPass.strength = 0.5 + Math.min(1, features.energy * 0.54 + features.onsetPulse * 0.6 + features.spectralFlux * 0.3);
    bloomPass.radius = 0.38 + Math.min(0.36, features.treblePulse * 0.18 + features.spectralFlatness * 0.08);
    if (scene.fog instanceof THREE.FogExp2) {
      scene.fog.density = 0.026 + features.energy * 0.012 + features.spectralFlatness * 0.006 + evolution.dna.turbulence * 0.004;
    }
  }
}

function createRenderTarget(width: number, height: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(width, height, {
    depthBuffer: false,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    stencilBuffer: false,
    type: THREE.HalfFloatType
  });
}

function createIdleFeatures(time: number): AudioFeatures {
  const silent = createSilentAudioFeatures(time);
  const bands = new Float32Array(VISUAL_BAND_COUNT);
  const bandEnvelopes = new Float32Array(VISUAL_BAND_COUNT);
  const bandPeaks = new Float32Array(VISUAL_BAND_COUNT);
  const bandTransients = new Float32Array(VISUAL_BAND_COUNT);
  const slowBands = new Float32Array(VISUAL_BAND_COUNT);
  const seconds = time * 0.001;
  for (let index = 0; index < VISUAL_BAND_COUNT; index += 1) {
    const drift = valueNoise(seconds * 0.08 + index * 0.17, index);
    const band = 0.018 + drift * 0.045;
    bands[index] = band;
    bandEnvelopes[index] = band * 0.82;
    bandPeaks[index] = band;
    bandTransients[index] = Math.max(0, drift - 0.72) * 0.08;
    slowBands[index] = band * 0.72;
  }

  const pulse = valueNoise(seconds * 0.18, 99);
  return {
    ...silent,
    rms: 0.025 + pulse * 0.035,
    bass: 0.04 + bands[2] * 0.8,
    mid: 0.035 + bands[10] * 0.65,
    treble: 0.025 + bands[19] * 0.55,
    centroid: 0.42 + valueNoise(seconds * 0.05, 18) * 0.16,
    beatPulse: 0.02 + bandTransients[3],
    energy: 0.045 + pulse * 0.055,
    spectralFlux: 0.025 + bandTransients[17],
    spectralFlatness: 0.18 + valueNoise(seconds * 0.04, 12) * 0.12,
    spectralRolloff: 0.36 + valueNoise(seconds * 0.05, 14) * 0.18,
    dynamicRange: 0.06 + valueNoise(seconds * 0.06, 15) * 0.08,
    onsetPulse: bandTransients[5],
    bassPulse: bandTransients[2],
    midPulse: bandTransients[10],
    treblePulse: bandTransients[20],
    bands,
    bandEnvelopes,
    bandPeaks,
    bandTransients,
    slowBands,
    novelty: 0.05 + valueNoise(seconds * 0.03, 31) * 0.08,
    onsetDensity: 0.08,
    loudnessTrend: 0.02,
    isSilent: true
  };
}

function valueNoise(x: number, seed: number): number {
  const base = Math.floor(x);
  const fraction = x - base;
  const a = hash(base, seed);
  const b = hash(base + 1, seed);
  const t = fraction * fraction * (3 - 2 * fraction);
  return lerp(a, b, t);
}

function hash(index: number, seed: number): number {
  let value = (index * 374_761_393 + seed * 668_265_263) | 0;
  value = Math.imul(value ^ (value >>> 13), 1_274_126_177);
  return ((value ^ (value >>> 16)) >>> 0) / 4_294_967_296;
}

function smoothstep(value: number): number {
  const t = clamp(value);
  return t * t * (3 - 2 * t);
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * clamp(alpha);
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function createFeedbackUniforms(): Record<string, THREE.IUniform> {
  return {
    tPrevious: { value: null },
    tCurrent: { value: null },
    uTime: { value: 0 },
    uDecay: { value: 0.9 },
    uScale: { value: 1 },
    uRotation: { value: 0 },
    uTranslate: { value: new THREE.Vector2(0, 0) },
    uDisplacement: { value: 0.01 },
    uCurrentMix: { value: 0.55 },
    uFade: { value: 0 },
    uColorShift: { value: 0 }
  };
}

const screenVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const feedbackFragmentShader = `
  precision highp float;

  varying vec2 vUv;
  uniform sampler2D tPrevious;
  uniform sampler2D tCurrent;
  uniform float uTime;
  uniform float uDecay;
  uniform float uScale;
  uniform float uRotation;
  uniform vec2 uTranslate;
  uniform float uDisplacement;
  uniform float uCurrentMix;
  uniform float uFade;
  uniform float uColorShift;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vec2 center = vec2(0.5) + uTranslate;
    vec2 p = vUv - center;
    float c = cos(uRotation);
    float s = sin(uRotation);
    p = mat2(c, -s, s, c) * p / max(0.001, uScale);
    float warp = noise(p * 3.1 + uTime * 0.07) - 0.5;
    vec2 radial = normalize(p + 0.0001) * warp * uDisplacement;
    vec2 previousUv = center + p + radial;
    vec3 previous = texture2D(tPrevious, previousUv).rgb * uDecay * (1.0 - uFade);
    vec3 current = texture2D(tCurrent, vUv).rgb * uCurrentMix;
    previous = mix(previous, previous.gbr, uColorShift * 0.025);
    vec3 color = clamp(previous + current, vec3(0.0), vec3(1.6));
    color = max(color - vec3(0.004), vec3(0.0));
    gl_FragColor = vec4(color, 1.0);
  }
`;

const finalFragmentShader = `
  precision highp float;

  varying vec2 vUv;
  uniform sampler2D tMap;

  void main() {
    vec3 color = texture2D(tMap, vUv).rgb;
    gl_FragColor = vec4(color, 1.0);
  }
`;
