import { app, BrowserWindow, desktopCapturer, ipcMain, nativeTheme, session } from 'electron';
import { join } from 'node:path';
import { is } from '@electron-toolkit/utils';

let mainWindow: BrowserWindow | null = null;

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

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#05070a',
    title: 'Spectra Drift',
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
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
