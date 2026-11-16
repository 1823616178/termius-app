import { app, shell } from 'electron'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import {
  DEFAULT_UPDATE_REPOSITORY,
  extractSha256FromDigest,
  getLatestManifestFilename,
  isUpdateNewer,
  normalizeVersionString,
  parseLatestYml,
  parseLatestYmlFiles,
  parseSha256Sums,
  resolveUpdatePackageKind,
  sanitizeInstallerFilename,
  selectInstallerAssetForPlatform,
  updatePreferencesPatchSchema,
  updatePreferencesSchema,
  validateUpdateSourceUrl,
  type GitHubReleaseWire,
  type LatestYmlMetadata,
  type UpdatePreferences,
  type UpdatePreferencesPatch,
  type UpdateReleaseInfo,
  type UpdateRepositoryConfig,
  type UpdateStatusSnapshot
} from '../shared/updater'

const CHECK_TIMEOUT_MS = 12_000
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000
const MAX_REDIRECTS = 6
const STARTUP_DELAY_MS = 3_500

export interface UpdateServiceCallbacks {
  onStateChanged: (snapshot: UpdateStatusSnapshot) => void
  onDiagnostic?: (message: string) => void
  onConfirmInstall?: () => Promise<boolean>
  onPrepareInstallQuit: () => void
}

function readPackagedRepository(): UpdateRepositoryConfig {
  if (app.isPackaged) {
    try {
      const ymlPath = join(process.resourcesPath, 'app-update.yml')
      if (existsSync(ymlPath)) {
        const content = readFileSync(ymlPath, 'utf8')
        const owner = /^owner:\s*['"]?([^\s'"]+)['"]?/m.exec(content)?.[1]
        const repo = /^repo:\s*['"]?([^\s'"]+)['"]?/m.exec(content)?.[1]
        if (owner && repo) {
          return { owner, repo }
        }
      }
    } catch {
      /* fallback to default repository config */
    }
  }
  return { ...DEFAULT_UPDATE_REPOSITORY }
}

async function computeFileDigests(filePath: string): Promise<{ sha256: string; sha512: string }> {
  const bytes = await readFile(filePath)
  const sha256 = createHash('sha256').update(bytes).digest('hex').toLowerCase()
  const sha512 = createHash('sha512').update(bytes).digest('base64')
  return { sha256, sha512 }
}

export class OrbitUpdateService {
  private readonly prefsPath: string
  private readonly updatesDir: string
  private readonly repository: UpdateRepositoryConfig
  private readonly currentVersion: string
  private readonly overrideBaseUrl: string | undefined
  private readonly overrideOrigin: string | undefined
  private prefs: UpdatePreferences
  private state: UpdateStatusSnapshot
  private checkPromise: Promise<UpdateStatusSnapshot> | null = null
  private downloadPromise: Promise<UpdateStatusSnapshot> | null = null
  private downloadAbort: AbortController | null = null
  private startupTimer: NodeJS.Timeout | undefined
  private disposed = false

  constructor(
    userDataDir: string,
    private readonly callbacks: UpdateServiceCallbacks
  ) {
    this.prefsPath = join(userDataDir, 'update-preferences.json')
    this.updatesDir = join(userDataDir, 'updates')
    this.repository = readPackagedRepository()
    this.currentVersion = normalizeVersionString(app.getVersion())

    const rawFeedOverride = process.env.ORBIT_UPDATE_FEED_URL?.trim()
    if (rawFeedOverride) {
      const normalized = rawFeedOverride.replace(/\/+$/, '')
      const parsed = new URL(normalized)
      this.overrideOrigin = parsed.origin
      this.overrideBaseUrl = validateUpdateSourceUrl(normalized, this.overrideOrigin).replace(/\/+$/, '')
    }

    this.prefs = this.loadPreferences()
    this.state = {
      phase: 'idle',
      currentVersion: this.currentVersion,
      repository: { ...this.repository },
      preferences: { ...this.prefs },
      latest: null,
      progress: null,
      downloadedFilePath: null,
      verifiedHash: null,
      message: '尚未检查更新，可手动检查 GitHub 最新版本。',
      error: null,
      checkedAt: this.prefs.lastCheckedAt
    }
  }

  private loadPreferences(): UpdatePreferences {
    try {
      if (!existsSync(this.prefsPath)) return updatePreferencesSchema.parse({})
      const raw = JSON.parse(readFileSync(this.prefsPath, 'utf8'))
      return updatePreferencesSchema.parse(raw)
    } catch {
      return updatePreferencesSchema.parse({})
    }
  }

  private savePreferences(): void {
    try {
      mkdirSync(join(this.prefsPath, '..'), { recursive: true })
      const tempPath = `${this.prefsPath}.tmp`
      writeFileSync(tempPath, JSON.stringify(this.prefs, null, 2), 'utf8')
      renameSync(tempPath, this.prefsPath)
    } catch {
      /* ignore non-fatal preference write failure */
    }
  }

  private updateState(patch: Partial<UpdateStatusSnapshot>): UpdateStatusSnapshot {
    this.state = {
      ...this.state,
      ...patch,
      preferences: { ...this.prefs },
      repository: { ...this.repository }
    }
    if (!this.disposed) {
      this.callbacks.onStateChanged(this.getState())
    }
    return this.getState()
  }

  getState(): UpdateStatusSnapshot {
    return {
      ...this.state,
      repository: { ...this.state.repository },
      preferences: { ...this.state.preferences },
      latest: this.state.latest ? { ...this.state.latest } : null,
      progress: this.state.progress ? { ...this.state.progress } : null
    }
  }

  scheduleStartupCheck(): void {
    if (this.disposed || process.env.ORBIT_UPDATE_DISABLE_AUTO === '1' || !this.prefs.autoCheckOnStartup) {
      return
    }
    clearTimeout(this.startupTimer)
    this.startupTimer = setTimeout(() => {
      if (!this.disposed && this.prefs.autoCheckOnStartup) {
        void this.checkForUpdates({ silent: true })
      }
    }, STARTUP_DELAY_MS)
  }

  updatePreferences(rawPatch: unknown): UpdateStatusSnapshot {
    const patch: UpdatePreferencesPatch = updatePreferencesPatchSchema.parse(rawPatch)
    const allowPrereleaseChanged =
      patch.allowPrerelease !== undefined && patch.allowPrerelease !== this.prefs.allowPrerelease
    this.prefs = updatePreferencesSchema.parse({ ...this.prefs, ...patch })
    this.savePreferences()
    const next = this.updateState({ preferences: { ...this.prefs } })
    if (allowPrereleaseChanged && this.state.phase !== 'downloading') {
      void this.checkForUpdates({ silent: true })
    }
    return next
  }

  private getApiBaseUrl(): string {
    return this.overrideBaseUrl ?? 'https://api.github.com'
  }

  private getWebBaseUrl(): string {
    return this.overrideBaseUrl ?? 'https://github.com'
  }

  private async fetchWithRedirectValidation(
    rawUrl: string,
    init: RequestInit,
    timeoutMs: number,
    externalSignal?: AbortSignal
  ): Promise<Response> {
    let currentUrl = validateUpdateSourceUrl(rawUrl, this.overrideOrigin)
    const timeoutController = new AbortController()
    const timer = setTimeout(() => timeoutController.abort(new Error('请求超时')), timeoutMs)
    const signal = externalSignal
      ? AbortSignal.any([timeoutController.signal, externalSignal])
      : timeoutController.signal

    try {
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const headers = new Headers(init.headers)
        if (!headers.has('User-Agent')) {
          headers.set('User-Agent', `Graphite-Orbit/${this.currentVersion}`)
        }
        const response = await fetch(currentUrl, {
          ...init,
          headers,
          redirect: 'manual',
          signal
        })
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location')
          if (!location) {
            throw new Error(`更新服务器重定向缺少目标地址 (${response.status})`)
          }
          const resolved = new URL(location, currentUrl).href
          currentUrl = validateUpdateSourceUrl(resolved, this.overrideOrigin)
          continue
        }
        return response
      }
      throw new Error('更新请求重定向次数过多')
    } finally {
      clearTimeout(timer)
    }
  }

  private async fetchOptionalTextAsset(assetUrl: string | undefined): Promise<string | null> {
    if (!assetUrl) return null
    try {
      const response = await this.fetchWithRedirectValidation(
        assetUrl,
        { headers: { Accept: 'text/plain, application/yaml, */*' } },
        CHECK_TIMEOUT_MS
      )
      if (!response.ok) return null
      return await response.text()
    } catch {
      return null
    }
  }

  private getTargetPlatform(): NodeJS.Platform {
    return process.platform
  }

  private detectLinuxPackageFormat(): 'appimage' | 'deb' {
    const override = process.env.ORBIT_LINUX_PACKAGE_FORMAT?.trim().toLowerCase()
    if (override === 'deb' || override === 'appimage') return override
    if (process.env.APPIMAGE) return 'appimage'
    if (
      existsSync('/var/lib/dpkg/info/graphite-orbit.list') ||
      (app.isPackaged && process.execPath.startsWith('/opt/'))
    ) {
      return 'deb'
    }
    return 'appimage'
  }

  private async checkViaLatestYmlFallback(): Promise<UpdateReleaseInfo | null> {
    const { owner, repo } = this.repository
    const platform = this.getTargetPlatform()
    const manifestName = getLatestManifestFilename(platform)
    const ymlUrl = `${this.getWebBaseUrl()}/${owner}/${repo}/releases/latest/download/${manifestName}`
    const response = await this.fetchWithRedirectValidation(
      ymlUrl,
      { headers: { Accept: 'text/plain, application/yaml, */*' } },
      CHECK_TIMEOUT_MS
    )
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`无法读取 ${manifestName} (HTTP ${response.status})`)
    }
    const ymlText = await response.text()
    const yml = parseLatestYml(ymlText)
    if (!yml) return null
    const fileEntries = parseLatestYmlFiles(ymlText)
    const preferredFormat = platform === 'linux' ? this.detectLinuxPackageFormat() : undefined
    const matchedFile =
      platform === 'linux' && preferredFormat
        ? (fileEntries.find((entry) => entry.url.toLowerCase().endsWith(`.${preferredFormat}`)) ??
          fileEntries[0])
        : fileEntries[0]

    const chosenPath = matchedFile?.url || yml.path
    const assetName = sanitizeInstallerFilename(basename(chosenPath), yml.version, platform)
    const packageKind = resolveUpdatePackageKind(assetName)
    const downloadUrl = `${this.getWebBaseUrl()}/${owner}/${repo}/releases/download/v${yml.version}/${encodeURIComponent(assetName)}`
    const sumsText = await this.fetchOptionalTextAsset(
      `${this.getWebBaseUrl()}/${owner}/${repo}/releases/latest/download/SHA256SUMS.txt`
    )
    const sumsMap = sumsText ? parseSha256Sums(sumsText) : new Map<string, string>()

    return {
      version: yml.version,
      tagName: `v${yml.version}`,
      title: `v${yml.version}`,
      notes: '',
      publishedAt: yml.releaseDate,
      releaseUrl: `${this.getWebBaseUrl()}/${owner}/${repo}/releases/tag/v${yml.version}`,
      prerelease: yml.version.includes('-'),
      assetName,
      packageKind,
      downloadUrl: validateUpdateSourceUrl(downloadUrl, this.overrideOrigin),
      sizeBytes: matchedFile?.size ?? yml.size,
      sha256: sumsMap.get(assetName.toLowerCase()) ?? null,
      sha512: matchedFile?.sha512 ?? yml.sha512
    }
  }

  private async fetchLatestReleaseFromGitHub(): Promise<{
    noReleasesPublished: boolean
    release: UpdateReleaseInfo | null
  }> {
    const { owner, repo } = this.repository
    const headers = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    }

    let selected: GitHubReleaseWire | undefined
    if (this.prefs.allowPrerelease) {
      const listUrl = `${this.getApiBaseUrl()}/repos/${owner}/${repo}/releases?per_page=15`
      const response = await this.fetchWithRedirectValidation(listUrl, { headers }, CHECK_TIMEOUT_MS)
      if (response.status === 403 || response.status === 429) {
        const fallback = await this.checkViaLatestYmlFallback()
        return { noReleasesPublished: !fallback, release: fallback }
      }
      if (!response.ok) {
        throw new Error(`GitHub Release 查询失败 (HTTP ${response.status})`)
      }
      const list = (await response.json()) as GitHubReleaseWire[]
      const candidates = list.filter((item) => !item.draft && Boolean(item.tag_name))
      if (candidates.length === 0) {
        return { noReleasesPublished: true, release: null }
      }
      candidates.sort((a, b) =>
        normalizeVersionString(b.tag_name) === normalizeVersionString(a.tag_name)
          ? 0
          : isUpdateNewer(b.tag_name, a.tag_name)
            ? 1
            : -1
      )
      selected = candidates[0]
    } else {
      const latestUrl = `${this.getApiBaseUrl()}/repos/${owner}/${repo}/releases/latest`
      const response = await this.fetchWithRedirectValidation(latestUrl, { headers }, CHECK_TIMEOUT_MS)
      if (response.status === 404) {
        return { noReleasesPublished: true, release: null }
      }
      if (response.status === 403 || response.status === 429) {
        const fallback = await this.checkViaLatestYmlFallback()
        return { noReleasesPublished: !fallback, release: fallback }
      }
      if (!response.ok) {
        throw new Error(`GitHub Release 查询失败 (HTTP ${response.status})`)
      }
      selected = (await response.json()) as GitHubReleaseWire
    }

    if (!selected || selected.draft) {
      return { noReleasesPublished: true, release: null }
    }

    const assets = selected.assets ?? []
    const platform = this.getTargetPlatform()
    const manifestName = getLatestManifestFilename(platform)
    const latestYmlAsset = assets.find((item) => item.name.toLowerCase() === manifestName)
    const sumsAsset = assets.find((item) => item.name.toLowerCase() === 'sha256sums.txt')
    const [latestYmlText, sumsText] = await Promise.all([
      this.fetchOptionalTextAsset(latestYmlAsset?.browser_download_url),
      this.fetchOptionalTextAsset(sumsAsset?.browser_download_url)
    ])

    const latestYml: LatestYmlMetadata | null = latestYmlText ? parseLatestYml(latestYmlText) : null
    const latestYmlFiles = latestYmlText ? parseLatestYmlFiles(latestYmlText) : []
    const sumsMap = sumsText ? parseSha256Sums(sumsText) : new Map<string, string>()
    const preferredLinuxFormat = platform === 'linux' ? this.detectLinuxPackageFormat() : undefined
    const installer = selectInstallerAssetForPlatform(assets, {
      platform,
      arch: process.arch,
      preferredLinuxFormat,
      latestYml
    })

    const version = normalizeVersionString(latestYml?.version || selected.tag_name)
    const fallbackDownloadUrl = `${this.getWebBaseUrl()}/${owner}/${repo}/releases/tag/${encodeURIComponent(selected.tag_name)}`
    const assetName = installer
      ? sanitizeInstallerFilename(installer.name, version, platform)
      : latestYml?.path
        ? sanitizeInstallerFilename(latestYml.path, version, platform)
        : platform === 'linux'
          ? `Graphite-Orbit-${version}-linux-${process.arch}.AppImage`
          : `Graphite-Orbit-Setup-${version}.exe`

    const matchedYmlFile = latestYmlFiles.find(
      (entry) => basename(entry.url).toLowerCase() === assetName.toLowerCase()
    )
    const resolvedSha512 =
      matchedYmlFile?.sha512 ??
      (latestYml && basename(latestYml.path).toLowerCase() === assetName.toLowerCase()
        ? latestYml.sha512
        : null)

    const sha256 =
      extractSha256FromDigest(installer?.digest) ??
      sumsMap.get(assetName.toLowerCase()) ??
      (installer ? sumsMap.get(installer.name.toLowerCase()) : undefined) ??
      null

    const packageKind = installer ? resolveUpdatePackageKind(assetName) : 'release-page'

    return {
      noReleasesPublished: false,
      release: {
        version,
        tagName: selected.tag_name,
        title: selected.name?.trim() || selected.tag_name,
        notes: selected.body?.trim() || '',
        publishedAt: selected.published_at ?? latestYml?.releaseDate ?? null,
        releaseUrl: validateUpdateSourceUrl(selected.html_url || fallbackDownloadUrl, this.overrideOrigin),
        prerelease: Boolean(selected.prerelease),
        assetName,
        packageKind,
        downloadUrl: installer
          ? validateUpdateSourceUrl(installer.browser_download_url, this.overrideOrigin)
          : '',
        sizeBytes: installer?.size ?? matchedYmlFile?.size ?? latestYml?.size ?? null,
        sha256,
        sha512: resolvedSha512
      }
    }
  }

  private async verifyExistingInstaller(
    filePath: string,
    release: UpdateReleaseInfo
  ): Promise<string | null> {
    if (!existsSync(filePath)) return null
    const stats = statSync(filePath)
    if (!stats.isFile() || stats.size === 0) return null
    const digests = await computeFileDigests(filePath)
    if (release.sha512 && digests.sha512 !== release.sha512) return null
    if (release.sha256 && digests.sha256 !== release.sha256) return null
    return `SHA256:${digests.sha256}`
  }

  async checkForUpdates(options?: { silent?: boolean }): Promise<UpdateStatusSnapshot> {
    if (this.state.phase === 'downloading') return this.getState()
    if (this.checkPromise) return this.checkPromise

    const silent = Boolean(options?.silent)
    const previousState = this.getState()

    this.checkPromise = (async () => {
      if (!silent) {
        this.updateState({
          phase: 'checking',
          error: null,
          message: `正在向 GitHub (${this.repository.owner}/${this.repository.repo}) 检查新版本…`
        })
      }
      const checkedAt = new Date().toISOString()
      try {
        const result = await this.fetchLatestReleaseFromGitHub()
        this.prefs.lastCheckedAt = checkedAt
        this.savePreferences()

        if (result.noReleasesPublished || !result.release) {
          return this.updateState({
            phase: 'up-to-date',
            latest: null,
            progress: null,
            downloadedFilePath: null,
            verifiedHash: null,
            checkedAt,
            error: null,
            message: `当前已是最新版本 v${this.currentVersion}（仓库暂未发布公开 Release）。`
          })
        }

        const release = result.release
        if (!isUpdateNewer(release.version, this.currentVersion)) {
          return this.updateState({
            phase: 'up-to-date',
            latest: release,
            progress: null,
            downloadedFilePath: null,
            verifiedHash: null,
            checkedAt,
            error: null,
            message: `当前已运行最新版本 v${this.currentVersion}。`
          })
        }

        const cachedPath = join(
          this.updatesDir,
          sanitizeInstallerFilename(release.assetName, release.version, this.getTargetPlatform())
        )
        const cachedHash = await this.verifyExistingInstaller(cachedPath, release)
        if (cachedHash) {
          if (resolveUpdatePackageKind(release.assetName) === 'appimage') {
            try {
              chmodSync(cachedPath, 0o755)
            } catch {
              /* ignore chmod error */
            }
          }
          const readyMessage =
            release.packageKind === 'deb'
              ? `新版本 v${release.version} (.deb) 已下载校验，点击查看安装命令（sudo apt install）。`
              : `新版本 v${release.version} 安装包已就绪并完成完整性校验，可直接安装。`
          return this.updateState({
            phase: 'downloaded',
            latest: release,
            progress: {
              transferredBytes: release.sizeBytes ?? 0,
              totalBytes: release.sizeBytes,
              percent: 100
            },
            downloadedFilePath: cachedPath,
            verifiedHash: cachedHash,
            checkedAt,
            error: null,
            message: readyMessage
          })
        }

        return this.updateState({
          phase: 'available',
          latest: release,
          progress: null,
          downloadedFilePath: null,
          verifiedHash: null,
          checkedAt,
          error: null,
          message: `发现新版本 v${release.version}（当前 v${this.currentVersion}）。`
        })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        this.callbacks.onDiagnostic?.(`update check failed: ${detail}`)
        if (silent) {
          return this.updateState({
            phase: previousState.phase === 'checking' ? 'idle' : previousState.phase,
            error: null
          })
        }
        return this.updateState({
          phase: 'error',
          checkedAt,
          error: detail,
          message: `检查更新失败：${detail}`
        })
      } finally {
        this.checkPromise = null
      }
    })()

    return this.checkPromise
  }

  async downloadUpdate(): Promise<UpdateStatusSnapshot> {
    if (this.downloadPromise) return this.downloadPromise
    const latest = this.state.latest
    if (!latest) {
      throw new Error('请先检查更新以获取最新版本信息。')
    }
    if (!latest.downloadUrl) {
      await this.openReleasePage()
      return this.getState()
    }

    const abortController = new AbortController()
    this.downloadAbort = abortController

    this.downloadPromise = (async () => {
      const fileName = sanitizeInstallerFilename(latest.assetName, latest.version)
      mkdirSync(this.updatesDir, { recursive: true })
      const finalPath = join(this.updatesDir, fileName)
      const tempPath = `${finalPath}.part`

      const existingHash = await this.verifyExistingInstaller(finalPath, latest)
      if (existingHash) {
        return this.updateState({
          phase: 'downloaded',
          progress: { transferredBytes: latest.sizeBytes ?? 0, totalBytes: latest.sizeBytes, percent: 100 },
          downloadedFilePath: finalPath,
          verifiedHash: existingHash,
          error: null,
          message: `v${latest.version} 安装包已存在且校验通过。`
        })
      }

      this.updateState({
        phase: 'downloading',
        progress: { transferredBytes: 0, totalBytes: latest.sizeBytes, percent: 0 },
        downloadedFilePath: null,
        verifiedHash: null,
        error: null,
        message: `正在下载 v${latest.version} 安装包…`
      })

      try {
        const response = await this.fetchWithRedirectValidation(
          latest.downloadUrl,
          { headers: { Accept: 'application/octet-stream' } },
          DOWNLOAD_TIMEOUT_MS,
          abortController.signal
        )
        if (!response.ok || !response.body) {
          throw new Error(`下载更新包失败 (HTTP ${response.status})`)
        }

        const headerLength = Number(response.headers.get('content-length') ?? 0)
        const totalBytes = headerLength > 0 ? headerLength : latest.sizeBytes
        const sha256Hash = createHash('sha256')
        const sha512Hash = createHash('sha512')
        let transferredBytes = 0
        let lastEmitAt = 0

        const reader = response.body.getReader()
        const sourceStream = new Readable({
          async read() {
            try {
              const { done, value } = await reader.read()
              if (done) {
                this.push(null)
                return
              }
              sha256Hash.update(value)
              sha512Hash.update(value)
              transferredBytes += value.byteLength
              this.push(value)
            } catch (err) {
              this.destroy(err instanceof Error ? err : new Error(String(err)))
            }
          }
        })

        sourceStream.on('data', () => {
          const now = Date.now()
          if (now - lastEmitAt >= 120) {
            lastEmitAt = now
            const percent =
              totalBytes && totalBytes > 0
                ? Math.min(99, Math.round((transferredBytes / totalBytes) * 100))
                : null
            this.updateState({
              phase: 'downloading',
              progress: { transferredBytes, totalBytes, percent }
            })
          }
        })

        const writeStream = createWriteStream(tempPath)
        await pipeline(sourceStream, writeStream)

        const computedSha256 = sha256Hash.digest('hex').toLowerCase()
        const computedSha512 = sha512Hash.digest('base64')

        if (latest.sha512 && computedSha512 !== latest.sha512) {
          throw new Error('SHA-512 校验和与 latest.yml 不一致，安装包可能损坏')
        }
        if (latest.sha256 && computedSha256 !== latest.sha256) {
          throw new Error('SHA-256 校验和与发布清单不一致，安装包可能损坏')
        }

        renameSync(tempPath, finalPath)
        const pkgKind = latest.packageKind ?? resolveUpdatePackageKind(latest.assetName)
        if (pkgKind === 'appimage') {
          try {
            chmodSync(finalPath, 0o755)
          } catch {
            /* ignore chmod failure */
          }
        }
        const verifiedLabel = latest.sha256
          ? `SHA256:${computedSha256}`
          : latest.sha512
            ? `SHA512:${computedSha512.slice(0, 16)}…`
            : `SHA256:${computedSha256}`

        const downloadedMessage =
          pkgKind === 'deb'
            ? `v${latest.version} (.deb) 下载并校验完成，请在终端执行 sudo apt install "${finalPath}" 完成升级。`
            : pkgKind === 'appimage'
              ? `v${latest.version} AppImage 已下载校验并赋可执行权限，点击即可启动新版程序。`
              : `v${latest.version} 下载并校验完成，点击即可启动安装程序升级。`

        return this.updateState({
          phase: 'downloaded',
          progress: { transferredBytes, totalBytes: transferredBytes, percent: 100 },
          downloadedFilePath: finalPath,
          verifiedHash: verifiedLabel,
          error: null,
          message: downloadedMessage
        })
      } catch (error) {
        rmSync(tempPath, { force: true })
        if (abortController.signal.aborted) {
          return this.updateState({
            phase: 'available',
            progress: null,
            error: null,
            message: `已取消下载 v${latest.version}。`
          })
        }
        const detail = error instanceof Error ? error.message : String(error)
        this.callbacks.onDiagnostic?.(`update download failed: ${detail}`)
        return this.updateState({
          phase: 'error',
          progress: null,
          error: detail,
          message: `下载更新失败：${detail}`
        })
      } finally {
        this.downloadAbort = null
        this.downloadPromise = null
      }
    })()

    return this.downloadPromise
  }

  cancelDownload(): UpdateStatusSnapshot {
    if (this.downloadAbort) {
      this.downloadAbort.abort(new Error('用户取消下载'))
    }
    return this.getState()
  }

  async installUpdate(): Promise<boolean> {
    const filePath = this.state.downloadedFilePath
    const latest = this.state.latest
    if (!filePath || !latest || !existsSync(filePath)) {
      throw new Error('更新安装包尚未下载或已被移除，请重新下载。')
    }
    const verified = await this.verifyExistingInstaller(filePath, latest)
    if (!verified) {
      rmSync(filePath, { force: true })
      this.updateState({
        phase: 'error',
        downloadedFilePath: null,
        verifiedHash: null,
        error: '安装包完整性复检失败，请重新下载。',
        message: '安装包完整性复检失败，请重新下载。'
      })
      return false
    }

    const pkgKind = latest.packageKind ?? resolveUpdatePackageKind(latest.assetName)

    if (pkgKind === 'deb') {
      if (process.env.ORBIT_UPDATE_TEST_DRY_INSTALL === '1') {
        return true
      }
      const openError = await shell.openPath(filePath).catch((err) => String(err))
      if (openError) {
        shell.showItemInFolder(filePath)
      }
      this.updateState({
        message: `请运行 sudo apt install "${filePath}" 或通过系统软件安装器完成 .deb 升级。`
      })
      return true
    }

    if (this.callbacks.onConfirmInstall) {
      const confirmed = await this.callbacks.onConfirmInstall()
      if (!confirmed) return false
    }

    if (process.env.ORBIT_UPDATE_TEST_DRY_INSTALL === '1') {
      return true
    }

    if (pkgKind === 'appimage') {
      try {
        chmodSync(filePath, 0o755)
      } catch {
        /* ignore chmod error */
      }
      await new Promise<void>((resolve, reject) => {
        const child = spawn(filePath, [], {
          detached: true,
          stdio: 'ignore'
        })
        let settled = false
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          child.unref()
          resolve()
        }, 350)
        child.once('error', (err) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(
            new Error(
              `无法启动 AppImage（若系统缺少 FUSE，可安装 libfuse2 或使用 --appimage-extract-and-run）：${err.message}`
            )
          )
        })
      })
      this.callbacks.onPrepareInstallQuit()
      return true
    }

    const openError = await shell.openPath(filePath)
    if (openError) {
      throw new Error(`无法启动安装程序：${openError}`)
    }
    this.callbacks.onPrepareInstallQuit()
    return true
  }

  revealDownloadedFile(): boolean {
    const filePath = this.state.downloadedFilePath
    if (!filePath || !existsSync(filePath)) return false
    shell.showItemInFolder(filePath)
    return true
  }

  async openReleasePage(): Promise<void> {
    const { owner, repo } = this.repository
    const fallbackUrl = `${this.getWebBaseUrl()}/${owner}/${repo}/releases`
    const targetUrl = validateUpdateSourceUrl(
      this.state.latest?.releaseUrl ?? fallbackUrl,
      this.overrideOrigin
    )
    await shell.openExternal(targetUrl)
  }

  dispose(): void {
    this.disposed = true
    clearTimeout(this.startupTimer)
    this.downloadAbort?.abort(new Error('应用退出'))
  }
}
