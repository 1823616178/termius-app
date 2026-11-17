import { createHmac } from 'node:crypto'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { instanceClass } from '../../src/shared/classes'
import {
  matchAppShortcut,
  matchTerminalShortcut,
  shouldInterceptInTerminal
} from '../../src/shared/shortcuts'
import { redactDiagnostic } from '../../src/main/diagnostics'
import {
  lookupOpenSshKnownHost,
  matchOpenSshHostPattern,
  parseOpenSshKnownHosts
} from '../../src/main/openssh-known-hosts'
import {
  decodeWslOutput,
  discoverPosixShells,
  findExecutableOnPath,
  parseEtcShells,
  parseWslDistributions,
  wslProfileId
} from '../../src/main/shells'
import {
  parseHostKeyAlgorithm,
  normalizeSshHost,
  resolveSshAgentSocket
} from '../../src/workers/connection/index'
import { sanitizeShellEnv } from '../../src/workers/local-pty/index'
import {
  TERMINAL_THEMES,
  buildShellColorizeCommand,
  cycleTerminalTheme,
  getTerminalTheme
} from '../../src/renderer/src/services/terminal-themes'
import {
  DEFAULT_CUSTOM_COLORS,
  UI_THEME_PRESETS,
  resolveUiThemeVariables
} from '../../src/renderer/src/services/ui-themes'
import { Repository } from '../../src/workers/data-crypto/database'
import {
  activeTab,
  detachPaneToTab,
  dockTabToSplit,
  isPaneTokenMounted,
  reorderTab,
  resolveSplitDropZone,
  splitEnteredPaneToken,
  tabs,
  windowInstance
} from '../../src/renderer/src/stores/workbench'

const tempDirs: string[] = []

afterEach(() => {
  tabs.value = []
  activeTab.value = ''
  splitEnteredPaneToken.value = ''
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true })
  }
})

function keyEvent(overrides: Partial<KeyboardEvent> & { code: string }): KeyboardEvent {
  return {
    type: 'keydown',
    isComposing: false,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    target: null,
    ...overrides
  } as KeyboardEvent
}

describe('shell discovery, redaction, SSH normalization, and UI helpers', () => {
  it('computes deterministic WSL profile IDs and decodes both UTF-8 and UTF-16LE wsl output', () => {
    expect(wslProfileId('Ubuntu-24.04')).toBe(wslProfileId('Ubuntu-24.04'))
    expect(wslProfileId('Ubuntu-24.04')).toMatch(/^wsl-[0-9a-f]{12}$/)
    expect(wslProfileId('Ubuntu')).not.toBe(wslProfileId('Debian'))

    const utf8 = Buffer.from(
      '\uFEFFUbuntu\r\nDebian\r\nUbuntu\r\nWindows Subsystem for Linux has no installed distributions.\r\n',
      'utf8'
    )
    expect(decodeWslOutput(utf8)).not.toContain('\uFEFF')
    expect(parseWslDistributions(utf8)).toEqual(['Ubuntu', 'Debian'])

    const utf16 = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('Alpine\r\nUbuntu-24.04\r\n', 'utf16le')
    ])
    expect(parseWslDistributions(utf16)).toEqual(['Alpine', 'Ubuntu-24.04'])
  })

  it('finds executables on quoted PATH segments and extra candidates across delimiters', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbit-path-test-'))
    tempDirs.push(dir)
    const binDir = join(dir, 'Quoted Tool')
    mkdirSync(binDir, { recursive: true })
    const exePath = join(binDir, 'pwsh.exe')
    writeFileSync(exePath, '')

    expect(findExecutableOnPath('pwsh.exe', [`"${binDir}"`, join(dir, 'missing')].join(delimiter), [])).toBe(
      exePath
    )
    expect(findExecutableOnPath('pwsh.exe', `"${binDir}"|C:\\missing`, [], '|')).toBe(exePath)
    expect(findExecutableOnPath('pwsh.exe', '', [exePath])).toBe(exePath)
    expect(findExecutableOnPath('pwsh.exe', 'relative/dir', [])).toBeUndefined()
  })

  it('discovers Linux POSIX shells honoring $SHELL first and deduplicating symlinks', () => {
    const etcContent = [
      '# /etc/shells: valid login shells',
      '/bin/sh',
      '/bin/bash',
      '/usr/bin/bash',
      '/usr/bin/zsh'
    ].join('\n')
    expect(parseEtcShells(etcContent)).toEqual(['/bin/sh', '/bin/bash', '/usr/bin/bash', '/usr/bin/zsh'])

    const execSet = new Set(['/usr/bin/zsh', '/bin/bash', '/usr/bin/bash', '/bin/sh'])
    const realMap = new Map<string, string>([
      ['/bin/bash', '/usr/bin/bash'],
      ['/usr/bin/bash', '/usr/bin/bash'],
      ['/usr/bin/zsh', '/usr/bin/zsh'],
      ['/bin/sh', '/usr/bin/dash']
    ])

    const shells = discoverPosixShells({
      envShell: '/usr/bin/zsh',
      envPath: '',
      etcShellsContent: etcContent,
      candidates: [],
      checkExecutable: (p) => execSet.has(p),
      resolveRealpath: (p) => realMap.get(p) ?? p
    })

    expect(shells.map((item) => item.executable)).toEqual(['/usr/bin/zsh', '/bin/sh', '/bin/bash'])
    expect(shells[0]?.kind).toBe('zsh')
    expect(shells[0]?.name).toContain('默认 Shell')
    expect(shells[2]?.kind).toBe('bash')

    const fallbackShells = discoverPosixShells({
      envShell: '/nonexistent/shell',
      envPath: '',
      etcShellsContent: '',
      candidates: ['/bin/bash', '/bin/sh'],
      checkExecutable: (p) => p === '/bin/bash' || p === '/bin/sh',
      resolveRealpath: (p) => p
    })
    expect(fallbackShells[0]?.executable).toBe('/bin/bash')
    expect(fallbackShells[0]?.kind).toBe('bash')
  })

  it('redacts sensitive paths, private keys, tokens, and sqlite paths', () => {
    const raw = [
      'C:\\Users\\Alice\\vault.sqlite',
      '/home/bob/secrets.sqlite-wal',
      'Authorization: Bearer abc.def-123 password=mysecret',
      '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----'
    ].join(' ')
    const redacted = redactDiagnostic(raw)
    expect(redacted).not.toContain('Alice')
    expect(redacted).not.toContain('bob')
    expect(redacted).not.toContain('mysecret')
    expect(redacted).not.toContain('abc.def-123')
    expect(redacted).not.toContain('-----BEGIN')
    expect(redacted).toContain('<database>')
    expect(redacted).toContain('[REDACTED_PRIVATE_KEY]')
  })

  it('sanitizes shell env for Windows and Linux separately by removing Electron variables', () => {
    const winEnv = sanitizeShellEnv(
      {
        PATH: 'C:\\Windows\\System32',
        ELECTRON_RUN_AS_NODE: '1',
        ELECTRON_NO_ASAR: '1',
        ORIGINAL_XDG_CURRENT_DESKTOP: 'GNOME',
        USERPROFILE: 'C:\\Users\\demo'
      },
      'win32'
    )
    expect(winEnv.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(winEnv.ELECTRON_NO_ASAR).toBeUndefined()
    expect(winEnv.ORIGINAL_XDG_CURRENT_DESKTOP).toBeUndefined()
    expect(winEnv.PATH).toBe('C:\\Windows\\System32')
    expect(winEnv.TERM).toBe('xterm-256color')
    expect(winEnv.COLORTERM).toBe('truecolor')
    expect(winEnv.TERM_PROGRAM).toBe('GraphiteOrbit')
    expect(winEnv.CLICOLOR).toBe('1')
    expect(winEnv.FORCE_COLOR).toBe('3')
    expect(winEnv.WSL_UTF8).toBe('1')
    expect(winEnv.LS_COLORS).toContain('di=01;36')
    expect(winEnv.PROMPT).toContain('$E[')

    const linuxEnv = sanitizeShellEnv(
      {
        PATH: '/usr/local/bin:/usr/bin:/bin',
        SHELL: '/bin/bash',
        ELECTRON_RUN_AS_NODE: '1',
        ORIGINAL_XDG_CURRENT_DESKTOP: 'ubuntu:GNOME'
      },
      'linux'
    )
    expect(linuxEnv.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(linuxEnv.ORIGINAL_XDG_CURRENT_DESKTOP).toBeUndefined()
    expect(linuxEnv.SHELL).toBe('/bin/bash')
    expect(linuxEnv.WSL_UTF8).toBeUndefined()
    expect(linuxEnv.PROMPT).toBeUndefined()
    expect(linuxEnv.TERM).toBe('xterm-256color')
    expect(linuxEnv.COLORTERM).toBe('truecolor')
  })

  it('provides 8 valid terminal themes and shell colorize commands for Windows and Linux', () => {
    expect(TERMINAL_THEMES).toHaveLength(8)
    const ids = TERMINAL_THEMES.map((item) => item.id)
    expect(new Set(ids).size).toBe(8)
    for (const preset of TERMINAL_THEMES) {
      expect(preset.swatches).toHaveLength(6)
      expect(preset.theme.background).toBeTruthy()
      expect(preset.theme.cursor).toBeTruthy()
      expect(getTerminalTheme(preset.id).id).toBe(preset.id)
    }
    expect(getTerminalTheme('non-existent').id).toBe('orbit-vivid')
    expect(cycleTerminalTheme('solarized-dark')).toBe('orbit-vivid')

    expect(buildShellColorizeCommand('ssh')).toContain('ls --color=auto')
    expect(buildShellColorizeCommand('local', 'wsl-ubuntu')).toContain('export PS1=')
    expect(buildShellColorizeCommand('local', 'bash')).toContain('export PS1=')
    expect(buildShellColorizeCommand('local', 'zsh')).toContain('export PS1=')
    expect(buildShellColorizeCommand('local', 'fish')).toContain('set -gx TERM')
    expect(buildShellColorizeCommand('local', 'cmd')).toContain('prompt $E[')
    expect(buildShellColorizeCommand('local', 'powershell')).toContain('Set-PSReadLineOption')
    expect(buildShellColorizeCommand('local', 'pwsh')).toContain('function global:prompt')
  })

  it('resolves SSH agent sockets per platform and matches OpenSSH ~/.ssh/known_hosts formats', () => {
    expect(resolveSshAgentSocket('win32', {})).toBe('\\\\.\\pipe\\openssh-ssh-agent')
    expect(resolveSshAgentSocket('linux', { SSH_AUTH_SOCK: '/run/user/1000/keyring/ssh' })).toBe(
      '/run/user/1000/keyring/ssh'
    )
    expect(resolveSshAgentSocket('linux', {})).toBeUndefined()

    const pubBytes = Buffer.from('mock-ssh-ed25519-public-key-payload-for-test')
    const pubB64 = pubBytes.toString('base64')
    const salt = Buffer.from('0123456789abcdef')
    const hashedHost = `|1|${salt.toString('base64')}|${createHmac('sha1', salt).update('[db.internal]:2222', 'utf8').digest('base64')}`

    expect(matchOpenSshHostPattern('prod.example.com,10.0.0.8', '10.0.0.8', 22)).toBe(true)
    expect(matchOpenSshHostPattern('*.example.com,!bad.example.com', 'bad.example.com', 22)).toBe(false)
    expect(matchOpenSshHostPattern('[db.internal]:2222', 'db.internal', 2222)).toBe(true)
    expect(matchOpenSshHostPattern(hashedHost, 'db.internal', 2222)).toBe(true)

    const dir = mkdtempSync(join(tmpdir(), 'orbit-known-hosts-'))
    tempDirs.push(dir)
    const khPath = join(dir, 'known_hosts')
    writeFileSync(
      khPath,
      [
        '# comment',
        `@revoked prod.example.com ssh-ed25519 ${pubB64}`,
        `web.local ssh-ed25519 ${pubB64}`,
        `${hashedHost} ssh-ed25519 ${pubB64}`
      ].join('\n'),
      'utf8'
    )

    const parsed = parseOpenSshKnownHosts(
      `web.local ssh-ed25519 ${pubB64}\n${hashedHost} ssh-ed25519 ${pubB64}`,
      'db.internal',
      2222
    )
    expect(parsed).toHaveLength(1)
    expect(parsed[0]?.fingerprint.startsWith('SHA256:')).toBe(true)

    const matched = lookupOpenSshKnownHost('db.internal', 2222, parsed[0]?.fingerprint, 'ssh-ed25519', [
      khPath
    ])
    expect(matched?.algorithm).toBe('ssh-ed25519')
    expect(matched?.source).toBe('openssh')
    expect(lookupOpenSshKnownHost('prod.example.com', 22, undefined, undefined, [khPath])).toBeUndefined()
  })

  it('normalizes bracketed IPv6 hosts and safely parses SSH host key algorithms', () => {
    expect(normalizeSshHost('[::1]')).toBe('::1')
    expect(normalizeSshHost(' 10.0.0.1 ')).toBe('10.0.0.1')

    const algo = 'ssh-ed25519'
    const validKey = Buffer.alloc(4 + algo.length + 32)
    validKey.writeUInt32BE(algo.length, 0)
    validKey.write(algo, 4, 'ascii')
    expect(parseHostKeyAlgorithm(validKey)).toBe('ssh-ed25519')

    const truncated = Buffer.alloc(6)
    truncated.writeUInt32BE(99, 0)
    expect(parseHostKeyAlgorithm(truncated)).toBe('unknown')
    expect(parseHostKeyAlgorithm(Buffer.alloc(2))).toBe('unknown')
  })

  it('generates instance classes and matches app/terminal shortcuts accurately', () => {
    expect(instanceClass('container_workspace_tabs_tab_base', 'tab-1')).toEqual([
      'container_workspace_tabs_tab_base',
      'container_workspace_tabs_tab_base-itab-1'
    ])
    expect(() => instanceClass('container_workspace_tabs_tab_base', 'Bad_Token')).toThrow(
      'Invalid instance token'
    )

    expect(matchAppShortcut(keyEvent({ ctrlKey: true, shiftKey: true, code: 'KeyW' }))).toBe('close-tab')
    expect(matchAppShortcut(keyEvent({ ctrlKey: true, code: 'Tab' }))).toBe('next-tab')
    expect(matchAppShortcut(keyEvent({ ctrlKey: true, shiftKey: true, code: 'Tab' }))).toBe('prev-tab')
    expect(matchAppShortcut(keyEvent({ ctrlKey: true, code: 'KeyK' }))).toBe('focus-host-search')
    expect(shouldInterceptInTerminal(keyEvent({ ctrlKey: true, shiftKey: true, code: 'KeyW' }))).toBe(true)
    expect(shouldInterceptInTerminal(keyEvent({ ctrlKey: true, code: 'KeyC' }))).toBe(false)

    expect(matchTerminalShortcut(keyEvent({ ctrlKey: true, shiftKey: true, code: 'KeyC' }))).toBe('copy')
    expect(matchTerminalShortcut(keyEvent({ ctrlKey: true, code: 'Insert' }))).toBe('copy')
    expect(matchTerminalShortcut(keyEvent({ ctrlKey: true, shiftKey: true, code: 'KeyV' }))).toBe('paste')
    expect(matchTerminalShortcut(keyEvent({ shiftKey: true, code: 'Insert' }))).toBe('paste')
    expect(matchTerminalShortcut(keyEvent({ ctrlKey: true, shiftKey: true, code: 'KeyF' }))).toBe('search')
  })

  it('resolves four-way split drop zones and merges/detaches tabs losslessly', () => {
    expect(resolveSplitDropZone(0.5, 0.12)).toBe('top')
    expect(resolveSplitDropZone(0.5, 0.88)).toBe('bottom')
    expect(resolveSplitDropZone(0.18, 0.5)).toBe('left')
    expect(resolveSplitDropZone(0.82, 0.5)).toBe('right')
    expect(resolveSplitDropZone(0.1, 0.2)).toBe('left')
    expect(resolveSplitDropZone(0.9, 0.85)).toBe('right')
    expect(resolveSplitDropZone(-0.5, 0.5)).toBe('left')
    expect(resolveSplitDropZone(1.5, 0.5)).toBe('right')

    tabs.value = [
      {
        token: 'tab-a',
        title: 'PowerShell',
        panes: [
          { token: 'pane-a', title: 'PowerShell', kind: 'local', profileId: 'powershell', state: 'running' }
        ],
        focusedPaneToken: 'pane-a',
        direction: 'horizontal',
        ratio: 50
      },
      {
        token: 'tab-b',
        title: 'CMD',
        panes: [{ token: 'pane-b', title: 'CMD', kind: 'local', profileId: 'cmd', state: 'running' }],
        focusedPaneToken: 'pane-b',
        direction: 'horizontal',
        ratio: 50
      }
    ]
    activeTab.value = 'tab-a'

    expect(dockTabToSplit('tab-a', 'tab-a', 'right')).toBe(false)
    expect(tabs.value).toHaveLength(2)
    expect(tabs.value[0]!.panes).toHaveLength(1)
    reorderTab('tab-a', 'tab-b', 'before')
    expect(tabs.value.map((tab) => tab.token)).toEqual(['tab-a', 'tab-b'])
    reorderTab('tab-a', 'tab-b', 'after')
    expect(tabs.value.map((tab) => tab.token)).toEqual(['tab-b', 'tab-a'])
    reorderTab('tab-a', 'tab-b', 'before')

    expect(dockTabToSplit('tab-b', 'tab-a', 'left')).toBe(true)
    expect(tabs.value).toHaveLength(1)
    expect(tabs.value[0]!.direction).toBe('horizontal')
    expect(tabs.value[0]!.panes.map((item) => item.token)).toEqual(['pane-b', 'pane-a'])
    expect(tabs.value[0]!.focusedPaneToken).toBe('pane-b')
    expect(splitEnteredPaneToken.value).toBe('pane-b')
    expect(isPaneTokenMounted(windowInstance('pane-b'))).toBe(true)

    expect(detachPaneToTab('tab-a', 'pane-b')).toBe(true)
    expect(tabs.value).toHaveLength(2)
    expect(tabs.value[0]!.panes.map((item) => item.token)).toEqual(['pane-a'])
    expect(tabs.value[1]!.panes.map((item) => item.token)).toEqual(['pane-b'])
    expect(activeTab.value).toBe(tabs.value[1]!.token)
    expect(isPaneTokenMounted(windowInstance('pane-b'))).toBe(true)

    expect(dockTabToSplit(tabs.value[1]!.token, 'tab-a', 'bottom')).toBe(true)
    expect(tabs.value).toHaveLength(1)
    expect(tabs.value[0]!.direction).toBe('vertical')
    expect(tabs.value[0]!.panes.map((item) => item.token)).toEqual(['pane-a', 'pane-b'])
  })

  it('provides 6 Daoist WuXing-Bagua UI presets and resolves custom CSS variables', () => {
    expect(UI_THEME_PRESETS).toHaveLength(6)
    expect(new Set(UI_THEME_PRESETS.map((p) => p.id)).size).toBe(6)
    expect(UI_THEME_PRESETS.map((p) => p.id)).toEqual([
      'bagua-taiji',
      'wuxing-mu',
      'wuxing-huo',
      'wuxing-tu',
      'wuxing-jin',
      'wuxing-shui'
    ])

    const muVars = resolveUiThemeVariables('wuxing-mu')
    expect(muVars['--color-accent-primary']).toBe('#34d399')
    expect(muVars['--color-app-bg']).toBe('#07100c')

    const customVars = resolveUiThemeVariables('custom', {
      ...DEFAULT_CUSTOM_COLORS,
      appBg: '#101218',
      accentPrimary: '#ff5500',
      accentSecondary: '#00ddff',
      textPrimary: '#fefefe'
    })
    expect(customVars['--color-app-bg']).toBe('#101218')
    expect(customVars['--color-accent-primary']).toBe('#ff5500')
    expect(customVars['--color-accent-secondary']).toBe('#00ddff')
    expect(customVars['--color-text-primary']).toBe('#fefefe')
    expect(customVars['--color-text-on-accent']).toBe('#f7f9fc')
    expect(
      resolveUiThemeVariables('custom', {
        ...DEFAULT_CUSTOM_COLORS,
        accentPrimary: '#ffd166'
      })['--color-text-on-accent']
    ).toBe('#101218')
  })

  it('persists vault key restore, writeMode and clears encrypted vault key on signout', () => {
    const repo = new Repository(':memory:')
    try {
      const saved = repo.syncAccountUpsert({
        serverUrl: 'http://127.0.0.1:46926',
        email: 'tao@example.com',
        rememberEmail: true,
        keepSignedIn: true,
        autoSync: true,
        writeMode: 'local-only',
        encryptedVaultKey: Uint8Array.from([1, 2, 3, 4]),
        deviceId: 'dev-1',
        deviceName: 'win-box'
      })
      expect(saved.writeMode).toBe('local-only')
      expect(saved.encryptedVaultKey).toBeDefined()

      const rawKey = Buffer.alloc(32, 0xab).toString('base64')
      expect(repo.vaultRestoreKey({ rawKeyBase64: rawKey })).toBe(true)
      expect(repo.vaultHasUnlockedKey()).toBe(true)
      expect(repo.vaultExportKey()).toBe(rawKey)
      expect(repo.vaultRestoreKey({ rawKeyBase64: Buffer.alloc(16, 0x11).toString('base64') })).toBe(false)

      const updated = repo.syncAccountUpsert({
        serverUrl: saved.serverUrl,
        email: saved.email,
        rememberEmail: saved.rememberEmail,
        keepSignedIn: saved.keepSignedIn,
        autoSync: saved.autoSync,
        writeMode: 'realtime',
        deviceId: saved.deviceId,
        deviceName: saved.deviceName
      })
      expect(updated.writeMode).toBe('realtime')

      const cleared = repo.syncAccountClearAuth({ clearEmail: false })
      expect(cleared?.encryptedVaultKey).toBeUndefined()
      expect(cleared?.encryptedRefreshToken).toBeUndefined()
      expect(repo.vaultHasUnlockedKey()).toBe(false)
    } finally {
      repo.close()
    }
  })
})
