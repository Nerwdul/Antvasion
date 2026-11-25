const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("antvasion", {
  quit: () => ipcRenderer.send("antvasion:quit")
});
