const { contextBridge } = require('electron');

// Expose a safe, minimal API to the renderer process
// Add any IPC bridges here in the future if needed
contextBridge.exposeInMainWorld('electronApp', {
  platform: process.platform,
});
