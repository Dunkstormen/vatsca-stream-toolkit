// Electron entry: starts the toolkit server inside the app and opens the control window on it.
// The OBS browser sources load the same server (http://localhost:7878/map.html), so the app must
// stay open while streaming; closing the window quits.

import path from "node:path";
import { app, BrowserWindow, dialog, shell } from "electron";
import { Toolkit } from "../server/server";

let toolkit: Toolkit | null = null;

async function createWindow(url: string): Promise<void> {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "VATSCA Stream Toolkit",
    backgroundColor: "#0f1216",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  // Links such as "open in browser" go to the system browser, not a new Electron window.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    void shell.openExternal(target);
    return { action: "deny" };
  });
  await win.loadURL(`${url}/control.html`);
}

app.whenReady().then(async () => {
  toolkit = new Toolkit({
    dataDir: app.getPath("userData"),
    webRoot: path.resolve(__dirname, "../../web"),
    assetsDir: path.resolve(__dirname, "../../../assets/basemap"),
  });
  let url: string;
  try {
    url = await toolkit.start();
  } catch (e) {
    dialog.showErrorBox("VATSCA Stream Toolkit", `Could not start the local server: ${(e as Error).message}\n\nIs the toolkit already running?`);
    app.quit();
    return;
  }
  await createWindow(url);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow(url);
  });
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  void toolkit?.stop();
});
