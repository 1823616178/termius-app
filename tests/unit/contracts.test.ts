import { describe, expect, it } from 'vitest'
import {
  hostInputSchema,
  normalizeStoredTrayPreferences,
  openSessionSchema,
  resolveKeepaliveIntervalMs,
  resolveTrayPreferences,
  terminalInputSchema,
  trayPreferencesPatchSchema,
  trayPreferencesSchema
} from '../../src/shared/contracts'
import {
  isInsecureHttpSyncUrl,
  syncLoginInputSchema,
  syncRegisterInputSchema,
  syncVaultRecoverInputSchema,
  validateSyncServerUrl
} from '../../src/shared/sync'
const host = { name: '开发服务器', address: 'example.test', port: 22, username: 'ubuntu' }
describe('host and IPC boundary validation', () => {
  it('supports DNS, IPv6, Unicode labels and normalizes metadata', () => {
    expect(hostInputSchema.parse({ ...host, name: ' 中文主机 ', address: '::1' }).name).toBe('中文主机')
  })
  it.each([0, -1, 65536, 22.5])('rejects invalid port %s', (port) => {
    expect(hostInputSchema.safeParse({ ...host, port }).success).toBe(false)
  })
  it.each(['host/path', 'host name', 'host\nname', 'host\\path', 'user@example.test'])(
    'rejects a non-host address %s',
    (address) => {
      expect(hostInputSchema.safeParse({ ...host, address }).success).toBe(false)
    }
  )
  it('returns localized errors for invalid port and conflicting password flags', () => {
    const portResult = hostInputSchema.safeParse({ ...host, port: 0 })
    expect(portResult.success).toBe(false)
    if (!portResult.success) {
      expect(portResult.error.issues[0]?.message).toBe('端口不能小于 1')
    }
    const conflict = hostInputSchema.safeParse({
      ...host,
      password: 'secret',
      clearPassword: true
    })
    expect(conflict.success).toBe(false)
    if (!conflict.success) {
      expect(conflict.error.issues[0]?.message).toBe('输入新密码时不能同时勾选移除已保存密码')
    }
  })
  it('enforces discriminated openSessionSchema branches and rejects unknown IPC fields', () => {
    expect(
      openSessionSchema.safeParse({
        requestId: crypto.randomUUID(),
        kind: 'local',
        cols: 80,
        rows: 24,
        profileId: 'pwsh'
      }).success
    ).toBe(true)
    expect(
      openSessionSchema.safeParse({
        requestId: crypto.randomUUID(),
        kind: 'local',
        cols: 80,
        rows: 24
      }).success
    ).toBe(false)
    expect(
      openSessionSchema.safeParse({
        requestId: crypto.randomUUID(),
        kind: 'local',
        cols: 80,
        rows: 24,
        profileId: 'pwsh',
        hostId: crypto.randomUUID()
      }).success
    ).toBe(false)
    expect(
      openSessionSchema.safeParse({
        requestId: crypto.randomUUID(),
        kind: 'ssh',
        cols: 80,
        rows: 24
      }).success
    ).toBe(false)
    expect(
      openSessionSchema.safeParse({
        requestId: crypto.randomUUID(),
        kind: 'ssh',
        cols: 80,
        rows: 24,
        hostId: crypto.randomUUID(),
        profileId: 'pwsh'
      }).success
    ).toBe(false)
    expect(
      openSessionSchema.safeParse({
        requestId: crypto.randomUUID(),
        kind: 'local',
        cols: 80,
        rows: 24,
        profileId: 'pwsh',
        executable: 'arbitrary.exe'
      }).success
    ).toBe(false)
    expect(hostInputSchema.safeParse({ ...host, secret: 'not-a-valid-field' }).success).toBe(false)
  })
  it('rejects oversized input and invisible PTY sizes', () => {
    expect(terminalInputSchema.safeParse({ type: 'input', data: 'a'.repeat(65537) }).success).toBe(false)
    expect(terminalInputSchema.safeParse({ type: 'resize', cols: 0, rows: 0 }).success).toBe(false)
  })
  it('resolves SSH keepalive interval milliseconds with 0 disabling keepalive', () => {
    expect(resolveKeepaliveIntervalMs(undefined)).toBe(30_000)
    expect(resolveKeepaliveIntervalMs(0)).toBe(0)
    expect(resolveKeepaliveIntervalMs(-5)).toBe(0)
    expect(resolveKeepaliveIntervalMs(45)).toBe(45_000)
    expect(resolveKeepaliveIntervalMs(9999)).toBe(3_600_000)
  })

  it('requires HTTPS or loopback HTTP by default for sync URLs and allows explicit opt-in for non-loopback HTTP', () => {
    expect(validateSyncServerUrl('https://sync.example.com/')).toBe('https://sync.example.com')
    expect(validateSyncServerUrl('http://127.0.0.1:8787///')).toBe('http://127.0.0.1:8787')
    expect(validateSyncServerUrl('http://localhost:8787/')).toBe('http://localhost:8787')
    expect(validateSyncServerUrl('http://[::1]:8787/')).toBe('http://[::1]:8787')
    expect(isInsecureHttpSyncUrl('http://192.168.1.50:8787')).toBe(true)
    expect(isInsecureHttpSyncUrl('http://127.0.0.1:8787')).toBe(false)
    expect(isInsecureHttpSyncUrl('https://sync.example.com')).toBe(false)

    expect(() => validateSyncServerUrl('http://192.168.1.50:8787///')).toThrow('HTTPS')
    expect(validateSyncServerUrl('http://192.168.1.50:8787///', { allowInsecureHttp: true })).toBe(
      'http://192.168.1.50:8787'
    )

    expect(
      syncLoginInputSchema.safeParse({
        serverUrl: 'http://sync.internal:8080/',
        email: 'User@Example.com',
        password: 'Password123'
      }).success
    ).toBe(false)
    expect(
      syncLoginInputSchema.parse({
        serverUrl: 'http://sync.internal:8080/',
        email: 'User@Example.com',
        password: 'Password123',
        allowInsecureHttp: true
      }).serverUrl
    ).toBe('http://sync.internal:8080')
    expect(() => validateSyncServerUrl('ftp://sync.example.com')).toThrow(
      '同步服务器地址仅支持 HTTP 或 HTTPS 协议'
    )
    expect(() => validateSyncServerUrl('http://user:pass@sync.internal:8080')).toThrow(
      '同步服务器地址不能包含用户名或密码'
    )
  })

  it('validates register inviteCode/password length and requires account password when resetting vault master password', () => {
    expect(
      syncRegisterInputSchema.safeParse({
        serverUrl: 'http://127.0.0.1:46926',
        email: 'user@example.com',
        password: 'shortpw'
      }).success
    ).toBe(false)

    expect(
      syncRegisterInputSchema.parse({
        serverUrl: 'http://127.0.0.1:46926',
        email: 'user@example.com',
        password: 'LongEnoughPassword1',
        inviteCode: ''
      }).inviteCode
    ).toBeUndefined()

    expect(
      syncVaultRecoverInputSchema.safeParse({
        recoveryKey: 'SPM1-ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8-EF4ED88BE4A3',
        newMasterPassword: 'NewMasterPassword!'
      }).success
    ).toBe(false)

    expect(
      syncVaultRecoverInputSchema.safeParse({
        recoveryKey: 'SPM1-ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8-EF4ED88BE4A3',
        newMasterPassword: 'NewMasterPassword!',
        currentAccountPassword: 'LongEnoughPassword1'
      }).success
    ).toBe(true)
  })

  it('validates background tray and close button preferences cleanly', () => {
    const defaults = trayPreferencesSchema.parse({})
    expect(defaults).toEqual({
      minimizeToTray: true,
      closeToTray: false,
      closeAction: 'quit',
      trayVisibility: 'when-minimized'
    })
    expect(
      trayPreferencesPatchSchema.parse({
        closeToTray: true,
        trayVisibility: 'always'
      })
    ).toEqual({
      closeToTray: true,
      trayVisibility: 'always'
    })
    expect(resolveTrayPreferences(defaults, { closeAction: 'tray' })).toEqual({
      minimizeToTray: true,
      closeToTray: true,
      closeAction: 'tray',
      trayVisibility: 'when-minimized'
    })
    expect(resolveTrayPreferences(defaults, { closeAction: 'minimize' })).toEqual({
      minimizeToTray: true,
      closeToTray: false,
      closeAction: 'minimize',
      trayVisibility: 'when-minimized'
    })
    expect(resolveTrayPreferences(defaults, { closeToTray: true })).toEqual({
      minimizeToTray: true,
      closeToTray: true,
      closeAction: 'tray',
      trayVisibility: 'when-minimized'
    })
    expect(normalizeStoredTrayPreferences({ closeToTray: true })).toEqual({
      minimizeToTray: true,
      closeToTray: true,
      closeAction: 'tray',
      trayVisibility: 'when-minimized'
    })
    expect(trayPreferencesSchema.safeParse({ trayVisibility: 'never' }).success).toBe(false)
    expect(trayPreferencesSchema.safeParse({ closeAction: 'destroy' }).success).toBe(false)
    expect(trayPreferencesPatchSchema.safeParse({ extraFlag: true }).success).toBe(false)
  })
})
