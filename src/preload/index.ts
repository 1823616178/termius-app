import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  Bridge,
  HostInput,
  HostTrust,
  OpenSessionInput,
  SyncDataUpdate,
  TrayAction,
  TrayPreferencesPatch,
  TrayState
} from '../shared/contracts'
import type { SftpProgressEvent } from '../shared/sftp'
import type { UpdatePreferencesPatch, UpdateStatusSnapshot } from '../shared/updater'
import type {
  SyncConflictResolutionItem,
  SyncGroupInput,
  SyncLoginInput,
  SyncPreferencesUpdate,
  SyncRegisterInput,
  SyncStatusSnapshot,
  SyncTunnelInput,
  SyncVaultCreateInput,
  SyncVaultRecoverInput,
  SyncVaultUnlockInput
} from '../shared/sync'
import { IPC } from '../shared/channels'

const api: Bridge = {
  clipboard: {
    readText: () => ipcRenderer.invoke(IPC.clipboardRead),
    writeText: (text) => ipcRenderer.invoke(IPC.clipboardWrite, text)
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke(IPC.openExternal, url)
  },
  bootstrap: () => ipcRenderer.invoke(IPC.bootstrap),
  hosts: {
    save: (input: HostInput) => ipcRenderer.invoke(IPC.hostSave, input),
    remove: (id: string) => ipcRenderer.invoke(IPC.hostRemove, id)
  },
  groups: {
    save: (input: SyncGroupInput) => ipcRenderer.invoke(IPC.groupSave, input),
    remove: (id: string) => ipcRenderer.invoke(IPC.groupRemove, id)
  },
  tunnels: {
    save: (input: SyncTunnelInput) => ipcRenderer.invoke(IPC.tunnelSave, input),
    remove: (id: string) => ipcRenderer.invoke(IPC.tunnelRemove, id),
    toggle: (input: { id: string; active: boolean }) => ipcRenderer.invoke(IPC.tunnelToggle, input),
    statuses: () => ipcRenderer.invoke(IPC.tunnelStatuses)
  },
  net: {
    probe: (input: { host: string; port: number; timeoutMs?: number }) =>
      ipcRenderer.invoke(IPC.netProbe, input),
    checkPort: (input: { listenHost: string; listenPort: number }) => ipcRenderer.invoke(IPC.portCheck, input)
  },
  knownHosts: {
    list: () => ipcRenderer.invoke(IPC.knownHostsList),
    remove: (hostKey: string) => ipcRenderer.invoke(IPC.knownHostsRemove, { hostKey })
  },
  sync: {
    getStatus: () => ipcRenderer.invoke(IPC.syncStatus),
    getDefaults: () => ipcRenderer.invoke(IPC.syncDefaults),
    register: (input: SyncRegisterInput) => ipcRenderer.invoke(IPC.syncRegister, input),
    login: (input: SyncLoginInput) => ipcRenderer.invoke(IPC.syncLogin, input),
    logout: () => ipcRenderer.invoke(IPC.syncLogout),
    createVault: (input: SyncVaultCreateInput) => ipcRenderer.invoke(IPC.syncVaultCreate, input),
    unlockVault: (input: SyncVaultUnlockInput) => ipcRenderer.invoke(IPC.syncVaultUnlock, input),
    recoverVault: (input: SyncVaultRecoverInput) => ipcRenderer.invoke(IPC.syncVaultRecover, input),
    lockVault: () => ipcRenderer.invoke(IPC.syncVaultLock),
    syncNow: () => ipcRenderer.invoke(IPC.syncRun),
    resolveConflicts: (resolutions: SyncConflictResolutionItem[]) =>
      ipcRenderer.invoke(IPC.syncResolveConflicts, { resolutions }),
    updatePreferences: (input: SyncPreferencesUpdate) => ipcRenderer.invoke(IPC.syncUpdatePreferences, input),
    listDevices: () => ipcRenderer.invoke(IPC.syncListDevices),
    revokeDevice: (deviceId: string) => ipcRenderer.invoke(IPC.syncRevokeDevice, deviceId),
    listRevisions: () => ipcRenderer.invoke(IPC.syncListRevisions),
    restoreRevision: (revision: string) => ipcRenderer.invoke(IPC.syncRestoreRevision, revision),
    onStatusChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, status: SyncStatusSnapshot) => callback(status)
      ipcRenderer.on(IPC.syncStatusChanged, listener)
      return () => {
        ipcRenderer.removeListener(IPC.syncStatusChanged, listener)
      }
    },
    onDataChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, data: SyncDataUpdate) => callback(data)
      ipcRenderer.on(IPC.syncDataChanged, listener)
      return () => {
        ipcRenderer.removeListener(IPC.syncDataChanged, listener)
      }
    }
  },
  shells: {
    refresh: () => ipcRenderer.invoke(IPC.shellsRefresh)
  },
  sessions: {
    open: (input: OpenSessionInput) => ipcRenderer.invoke(IPC.sessionOpen, input),
    close: (id: string) => ipcRenderer.invoke(IPC.sessionClose, id),
    trust: (id: string, accept: boolean) => ipcRenderer.invoke(IPC.trust, { id, accept })
  },
  onTrust: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, request: HostTrust) => callback(request)
    ipcRenderer.on(IPC.trustRequest, listener)
    return () => {
      ipcRenderer.removeListener(IPC.trustRequest, listener)
    }
  },
  onSessionFailure: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, request: { id: string; message: string }) =>
      callback(request)
    ipcRenderer.on(IPC.sessionFailure, listener)
    return () => {
      ipcRenderer.removeListener(IPC.sessionFailure, listener)
    }
  },
  window: {
    minimize: () => ipcRenderer.send(IPC.window, 'minimize'),
    maximize: () => ipcRenderer.send(IPC.window, 'maximize'),
    close: () => ipcRenderer.send(IPC.window, 'close'),
    hideToTray: () => ipcRenderer.send(IPC.window, 'hide-to-tray'),
    restoreFromTray: () => ipcRenderer.send(IPC.window, 'restore-from-tray'),
    isMaximized: () => ipcRenderer.invoke(IPC.windowIsMaximized),
    onMaximized: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized)
      ipcRenderer.on(IPC.windowState, listener)
      return () => {
        ipcRenderer.removeListener(IPC.windowState, listener)
      }
    }
  },
  tray: {
    getState: () => ipcRenderer.invoke(IPC.trayState),
    updatePreferences: (patch: TrayPreferencesPatch) => ipcRenderer.invoke(IPC.trayUpdatePreferences, patch),
    onStateChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, state: TrayState) => callback(state)
      ipcRenderer.on(IPC.trayStateChanged, listener)
      return () => {
        ipcRenderer.removeListener(IPC.trayStateChanged, listener)
      }
    },
    onAction: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, action: TrayAction) => callback(action)
      ipcRenderer.on(IPC.trayAction, listener)
      return () => {
        ipcRenderer.removeListener(IPC.trayAction, listener)
      }
    }
  },
  update: {
    getState: () => ipcRenderer.invoke(IPC.updateState),
    checkForUpdates: () => ipcRenderer.invoke(IPC.updateCheck),
    downloadUpdate: () => ipcRenderer.invoke(IPC.updateDownload),
    cancelDownload: () => ipcRenderer.invoke(IPC.updateCancelDownload),
    installUpdate: () => ipcRenderer.invoke(IPC.updateInstall),
    revealDownloadedFile: () => ipcRenderer.invoke(IPC.updateRevealFile),
    openReleasePage: () => ipcRenderer.invoke(IPC.updateOpenReleasePage),
    updatePreferences: (patch: UpdatePreferencesPatch) =>
      ipcRenderer.invoke(IPC.updateUpdatePreferences, patch),
    onStateChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, state: UpdateStatusSnapshot) => callback(state)
      ipcRenderer.on(IPC.updateStateChanged, listener)
      return () => {
        ipcRenderer.removeListener(IPC.updateStateChanged, listener)
      }
    }
  },
  sftp: {
    home: (sessionId) => ipcRenderer.invoke(IPC.sftpHome, { sessionId }),
    list: (sessionId, path) => ipcRenderer.invoke(IPC.sftpList, { sessionId, path }),
    stat: (sessionId, path) => ipcRenderer.invoke(IPC.sftpStat, { sessionId, path }),
    collectTree: (sessionId, path) => ipcRenderer.invoke(IPC.sftpCollectTree, { sessionId, path }),
    mkdir: (sessionId, path) => ipcRenderer.invoke(IPC.sftpMkdir, { sessionId, path }),
    rename: (sessionId, oldPath, newPath) =>
      ipcRenderer.invoke(IPC.sftpRename, { sessionId, oldPath, newPath }),
    chmod: (sessionId, path, mode) => ipcRenderer.invoke(IPC.sftpChmod, { sessionId, path, mode }),
    remove: (sessionId, path, recursive) =>
      ipcRenderer.invoke(IPC.sftpDelete, { sessionId, path, recursive }),
    upload: (input) => ipcRenderer.invoke(IPC.sftpUpload, input),
    download: (input) => ipcRenderer.invoke(IPC.sftpDownload, input),
    cancelTransfer: (sessionId, transferId) =>
      ipcRenderer.invoke(IPC.sftpCancelTransfer, { sessionId, transferId }),
    pickUploadFiles: () => ipcRenderer.invoke(IPC.sftpPickUploadFiles),
    pickUploadDirs: () => ipcRenderer.invoke(IPC.sftpPickUploadDirs),
    pickDownloadDir: () => ipcRenderer.invoke(IPC.sftpPickDownloadDir),
    pickDownloadFile: (defaultName) => ipcRenderer.invoke(IPC.sftpPickDownloadFile, { defaultName }),
    expandLocalUploads: (localPaths) => ipcRenderer.invoke(IPC.sftpExpandLocalUploads, { localPaths }),
    revealLocal: (localPath) => ipcRenderer.invoke(IPC.sftpRevealLocal, { localPath }),
    getDroppedPaths: (files) => {
      const paths: string[] = []
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        if (!file) continue
        try {
          const p = webUtils.getPathForFile(file)
          if (p) paths.push(p)
        } catch {
          /* ignore non-local drop items */
        }
      }
      return paths
    },
    onProgress: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, event: SftpProgressEvent) => callback(event)
      ipcRenderer.on(IPC.sftpProgress, listener)
      return () => {
        ipcRenderer.removeListener(IPC.sftpProgress, listener)
      }
    }
  }
}
contextBridge.exposeInMainWorld('orbit', api)
ipcRenderer.on(IPC.port, (event, data) => {
  window.postMessage({ type: 'orbit:terminal-port', ...data }, window.location.origin, event.ports)
})
