import { describe, expect, it } from 'vitest'
import {
  compareSemver,
  extractSha256FromDigest,
  isUpdateNewer,
  parseLatestYml,
  parseSemver,
  parseSha256Sums,
  sanitizeInstallerFilename,
  selectWindowsInstallerAsset,
  updatePreferencesPatchSchema,
  updatePreferencesSchema,
  validateUpdateSourceUrl
} from '../../src/shared/updater'

describe('updater semver, manifest parsing and URL security', () => {
  it('parses and compares SemVer stable and prerelease versions accurately', () => {
    expect(parseSemver('v0.1.0')).toEqual({ major: 0, minor: 1, patch: 0, prerelease: [] })
    expect(parseSemver('1.2.3-beta.2+win64')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ['beta', '2']
    })
    expect(parseSemver('not-a-version')).toBeNull()

    expect(isUpdateNewer('v0.1.1', '0.1.0')).toBe(true)
    expect(isUpdateNewer('v0.10.0', '0.2.0')).toBe(true)
    expect(isUpdateNewer('0.1.0', '0.1.0')).toBe(false)
    expect(isUpdateNewer('0.2.0-beta.1', '0.2.0')).toBe(false)
    expect(isUpdateNewer('0.2.0', '0.2.0-beta.1')).toBe(true)
    expect(compareSemver('0.2.0-beta.2', '0.2.0-alpha.9')).toBeGreaterThan(0)
  })

  it('parses electron-builder latest.yml and SHA256SUMS.txt manifests', () => {
    const yml = [
      'version: 0.2.0',
      'files:',
      '  - url: Graphite-Orbit-Setup-0.2.0.exe',
      '    sha512: abcdef123456==',
      '    size: 130449440',
      'path: Graphite-Orbit-Setup-0.2.0.exe',
      'sha512: abcdef123456==',
      "releaseDate: '2026-11-15T08:00:00.000Z'"
    ].join('\n')

    expect(parseLatestYml(yml)).toEqual({
      version: '0.2.0',
      path: 'Graphite-Orbit-Setup-0.2.0.exe',
      sha512: 'abcdef123456==',
      size: 130449440,
      releaseDate: '2026-11-15T08:00:00.000Z'
    })

    const sums = parseSha256Sums(
      [
        '959602B89FF5A7F16054907F36A07DF7D3D4E77E5A359A48B65B11C867D0BC12  ./Graphite-Orbit-Setup-0.2.0.exe',
        '89AD12301220F5D8773C446AFCAD29824135FF5D030855EC7928949EBCC5FBA3 *win-unpacked/Graphite Orbit.exe'
      ].join('\n')
    )
    expect(sums.get('graphite-orbit-setup-0.2.0.exe')).toBe(
      '959602b89ff5a7f16054907f36a07df7d3d4e77e5a359a48b65b11c867d0bc12'
    )
    expect(sums.get('graphite orbit.exe')).toBe(
      '89ad12301220f5d8773c446afcad29824135ff5d030855ec7928949ebcc5fba3'
    )
  })

  it('validates GitHub HTTPS sources and rejects untrusted redirect hosts or credentials', () => {
    expect(
      validateUpdateSourceUrl('https://api.github.com/repos/1823616178/termius-app/releases/latest')
    ).toBe('https://api.github.com/repos/1823616178/termius-app/releases/latest')
    expect(validateUpdateSourceUrl('https://release-assets.githubusercontent.com/file.exe')).toBe(
      'https://release-assets.githubusercontent.com/file.exe'
    )
    expect(() => validateUpdateSourceUrl('http://github.com/file.exe')).toThrow('HTTPS')
    expect(() => validateUpdateSourceUrl('https://evil.example.com/file.exe')).toThrow('不受信任')
    expect(() => validateUpdateSourceUrl('https://token:secret@github.com/file.exe')).toThrow('凭据')
    expect(validateUpdateSourceUrl('http://127.0.0.1:45678/releases', 'http://127.0.0.1:45678')).toBe(
      'http://127.0.0.1:45678/releases'
    )
  })

  it('selects matching Windows NSIS installer asset and extracts SHA256 digests', () => {
    const assets = [
      {
        name: 'Graphite-Orbit-Setup-0.2.0.exe.blockmap',
        browser_download_url: 'https://github.com/a.blockmap'
      },
      { name: 'latest.yml', browser_download_url: 'https://github.com/latest.yml' },
      {
        name: 'Graphite-Orbit-Setup-0.2.0.exe',
        size: 1024,
        browser_download_url: 'https://github.com/setup.exe',
        digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
      }
    ]
    const picked = selectWindowsInstallerAsset(assets, {
      version: '0.2.0',
      path: 'Graphite-Orbit-Setup-0.2.0.exe',
      sha512: 'xyz',
      size: 1024,
      releaseDate: null
    })
    expect(picked?.name).toBe('Graphite-Orbit-Setup-0.2.0.exe')
    expect(extractSha256FromDigest(picked?.digest)).toBe(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    )
    expect(sanitizeInstallerFilename('../evil/Graphite-Orbit-Setup-0.2.0.exe', '0.2.0')).toBe(
      'Graphite-Orbit-Setup-0.2.0.exe'
    )
  })

  it('enforces strict zod schemas for update preferences', () => {
    expect(updatePreferencesSchema.parse({})).toEqual({
      autoCheckOnStartup: true,
      allowPrerelease: false,
      ignoredVersion: null,
      lastCheckedAt: null
    })
    expect(updatePreferencesPatchSchema.safeParse({ allowPrerelease: true }).success).toBe(true)
    expect(updatePreferencesPatchSchema.safeParse({ customFeedUrl: 'https://bad.test' }).success).toBe(false)
  })
})
