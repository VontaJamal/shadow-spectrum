import { contextBridge, ipcRenderer } from 'electron';

const api = {
  isElectron: true,
  platform: process.platform,
  versions: {
    chrome: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node
  },
  toggleFullscreen: () => ipcRenderer.invoke('window:toggle-fullscreen') as Promise<boolean>,
  isFullscreen: () => ipcRenderer.invoke('window:is-fullscreen') as Promise<boolean>
};

contextBridge.exposeInMainWorld('visualizerApi', api);

export type VisualizerApi = typeof api;

