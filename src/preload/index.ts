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
  isFullscreen: () => ipcRenderer.invoke('window:is-fullscreen') as Promise<boolean>,
  startSystemAudio: () => ipcRenderer.invoke('system-audio:start') as Promise<{ ok: boolean; message: string }>,
  stopSystemAudio: () => ipcRenderer.invoke('system-audio:stop') as Promise<{ ok: boolean }>,
  onSystemAudioFeatures: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => callback(payload);
    ipcRenderer.on('system-audio:features', listener);
    return () => ipcRenderer.removeListener('system-audio:features', listener);
  },
  onSystemAudioStatus: (callback: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => callback(payload);
    ipcRenderer.on('system-audio:status', listener);
    return () => ipcRenderer.removeListener('system-audio:status', listener);
  }
};

contextBridge.exposeInMainWorld('visualizerApi', api);

export type VisualizerApi = typeof api;
