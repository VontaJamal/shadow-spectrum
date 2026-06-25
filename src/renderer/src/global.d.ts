import type { VisualizerApi } from '../../preload';

declare global {
  interface Window {
    visualizerApi?: VisualizerApi;
  }
}

export {};

