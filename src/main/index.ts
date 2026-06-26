import { app, BrowserWindow, desktopCapturer, ipcMain, nativeTheme, session } from 'electron';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { Readable } from 'node:stream';
import { join } from 'node:path';
import { is } from '@electron-toolkit/utils';
import { APP_ID, APP_NAME } from '../shared/branding';

let mainWindow: BrowserWindow | null = null;
let systemAudioProcess: ChildProcessByStdio<null, Readable, Readable> | null = null;
let systemAudioStderr = '';

function configureMediaCapture(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media' || permission === 'display-capture');
  });

  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 1, height: 1 }
        });

        const primaryDisplay = sources[0];

        if (!primaryDisplay) {
          callback({});
          return;
        }

        callback({
          video: primaryDisplay,
          audio: 'loopback'
        } as unknown as Parameters<typeof callback>[0]);
      } catch {
        callback({});
      }
    },
    { useSystemPicker: false }
  );
}

function findSystemAudioHelper(): string | null {
  const candidates = [
    join(app.getAppPath(), 'native/bin/SystemAudioHelper'),
    join(process.cwd(), 'native/bin/SystemAudioHelper'),
    join(process.resourcesPath ?? '', 'SystemAudioHelper')
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function sendToRenderer(channel: string, payload: unknown): void {
  mainWindow?.webContents.send(channel, payload);
}

function handleSystemAudioLine(line: string): void {
  if (!line.trim()) {
    return;
  }

  try {
    const payload = JSON.parse(line) as { type?: string };

    if (payload.type === 'features') {
      sendToRenderer('system-audio:features', payload);
    } else if (payload.type === 'status') {
      sendToRenderer('system-audio:status', payload);
    }
  } catch {
    sendToRenderer('system-audio:status', {
      type: 'status',
      status: 'error',
      message: 'System audio helper sent unreadable data'
    });
  }
}

function stopSystemAudioCapture(): void {
  const processToStop = systemAudioProcess;
  systemAudioProcess = null;

  if (processToStop && !processToStop.killed) {
    processToStop.kill('SIGTERM');
  }
}

function startSystemAudioCapture(): { ok: boolean; message: string } {
  if (process.platform !== 'darwin') {
    return { ok: false, message: 'Native system audio capture is only used on macOS' };
  }

  if (systemAudioProcess) {
    return { ok: true, message: 'System audio capture is already running' };
  }

  const helperPath = findSystemAudioHelper();
  if (!helperPath) {
    return { ok: false, message: 'System audio helper is missing. Run npm run build:native.' };
  }

  systemAudioStderr = '';
  const child = spawn(helperPath, [], {
    cwd: app.getAppPath(),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  systemAudioProcess = child;

  let stdoutBuffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split('\n');
    stdoutBuffer = lines.pop() ?? '';
    lines.forEach(handleSystemAudioLine);
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    systemAudioStderr += chunk;
  });

  child.on('error', (error) => {
    if (systemAudioProcess === child) {
      systemAudioProcess = null;
    }

    sendToRenderer('system-audio:status', {
      type: 'status',
      status: 'error',
      message: error.message
    });
  });

  child.on('exit', (code) => {
    if (systemAudioProcess === child) {
      systemAudioProcess = null;
    }

    if (code !== 0) {
      sendToRenderer('system-audio:status', {
        type: 'status',
        status: 'error',
        message: systemAudioStderr.trim() || 'System audio capture stopped'
      });
    }
  });

  return { ok: true, message: 'System audio helper started' };
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#05070a',
    title: APP_NAME,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId(APP_ID);
  app.setName(APP_NAME);
  nativeTheme.themeSource = 'dark';
  configureMediaCapture();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.handle('window:toggle-fullscreen', () => {
  if (!mainWindow) {
    return false;
  }

  mainWindow.setFullScreen(!mainWindow.isFullScreen());
  return mainWindow.isFullScreen();
});

ipcMain.handle('window:is-fullscreen', () => mainWindow?.isFullScreen() ?? false);

ipcMain.handle('system-audio:start', () => startSystemAudioCapture());
ipcMain.handle('system-audio:stop', () => {
  stopSystemAudioCapture();
  return { ok: true };
});

app.on('before-quit', () => {
  stopSystemAudioCapture();
});
