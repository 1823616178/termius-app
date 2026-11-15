import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface MockUpdateServerHandle {
  url: string
  setPrereleaseAvailable(enabled: boolean): void
  close(): Promise<void>
}

export async function startMockUpdateServer(): Promise<MockUpdateServerHandle> {
  const stableBinary = Buffer.from('MZ-MOCK-ORBIT-INSTALLER-0.2.0-PAYLOAD-' + 'A'.repeat(65536), 'utf8')
  const stableSha256 = createHash('sha256').update(stableBinary).digest('hex').toLowerCase()
  const stableSha512 = createHash('sha512').update(stableBinary).digest('base64')

  const betaBinary = Buffer.from('MZ-MOCK-ORBIT-INSTALLER-0.3.0-BETA-1-' + 'B'.repeat(40960), 'utf8')
  const betaSha256 = createHash('sha256').update(betaBinary).digest('hex').toLowerCase()
  const betaSha512 = createHash('sha512').update(betaBinary).digest('base64')

  let includePrerelease = false

  function sendJson(res: ServerResponse, status: number, body: unknown): void {
    const json = JSON.stringify(body)
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(json))
    })
    res.end(json)
  }

  let baseUrl = ''

  function buildRelease(version: string, prerelease: boolean, binary: Buffer, sha256: string) {
    const tag = `v${version}`
    const exeName = `Graphite-Orbit-Setup-${version}.exe`
    return {
      tag_name: tag,
      name: `Graphite Orbit ${tag}`,
      body: prerelease
        ? '### 预发布更新说明\n- 剑气御风：优化终端低延迟渲染\n- 新增实验性预发布检测通道'
        : '### 正式版更新说明\n- 玄墨剑侠主题升级\n- 新增应用内 GitHub 更新检查与校验安装\n- 优化后台托盘与 E2EE 并发同步',
      draft: false,
      prerelease,
      published_at: '2026-11-15T08:30:00Z',
      html_url: `${baseUrl}/1823616178/termius-app/releases/tag/${tag}`,
      assets: [
        {
          name: exeName,
          size: binary.byteLength,
          browser_download_url: `${baseUrl}/downloads/${exeName}`,
          digest: `sha256:${sha256}`
        },
        {
          name: 'latest.yml',
          size: 256,
          browser_download_url: `${baseUrl}/downloads/latest-${version}.yml`
        },
        {
          name: 'SHA256SUMS.txt',
          size: 160,
          browser_download_url: `${baseUrl}/downloads/SHA256SUMS-${version}.txt`
        }
      ]
    }
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const reqUrl = new URL(req.url || '/', baseUrl || 'http://127.0.0.1')
    const pathname = reqUrl.pathname

    if (pathname === '/repos/1823616178/termius-app/releases/latest') {
      sendJson(res, 200, buildRelease('0.2.0', false, stableBinary, stableSha256))
      return
    }

    if (pathname === '/repos/1823616178/termius-app/releases') {
      const items = includePrerelease
        ? [
            buildRelease('0.3.0-beta.1', true, betaBinary, betaSha256),
            buildRelease('0.2.0', false, stableBinary, stableSha256)
          ]
        : [buildRelease('0.2.0', false, stableBinary, stableSha256)]
      sendJson(res, 200, items)
      return
    }

    if (pathname === '/downloads/latest-0.2.0.yml') {
      const text = [
        'version: 0.2.0',
        'files:',
        '  - url: Graphite-Orbit-Setup-0.2.0.exe',
        `    sha512: ${stableSha512}`,
        `    size: ${stableBinary.byteLength}`,
        'path: Graphite-Orbit-Setup-0.2.0.exe',
        `sha512: ${stableSha512}`,
        "releaseDate: '2026-11-15T08:30:00.000Z'"
      ].join('\n')
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(text)
      return
    }

    if (pathname === '/downloads/latest-0.3.0-beta.1.yml') {
      const text = [
        'version: 0.3.0-beta.1',
        'files:',
        '  - url: Graphite-Orbit-Setup-0.3.0-beta.1.exe',
        `    sha512: ${betaSha512}`,
        `    size: ${betaBinary.byteLength}`,
        'path: Graphite-Orbit-Setup-0.3.0-beta.1.exe',
        `sha512: ${betaSha512}`,
        "releaseDate: '2026-11-15T08:35:00.000Z'"
      ].join('\n')
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(text)
      return
    }

    if (pathname === '/downloads/SHA256SUMS-0.2.0.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(`${stableSha256}  Graphite-Orbit-Setup-0.2.0.exe\n`)
      return
    }

    if (pathname === '/downloads/SHA256SUMS-0.3.0-beta.1.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(`${betaSha256}  Graphite-Orbit-Setup-0.3.0-beta.1.exe\n`)
      return
    }

    if (pathname === '/downloads/Graphite-Orbit-Setup-0.2.0.exe') {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(stableBinary.byteLength)
      })
      res.end(stableBinary)
      return
    }

    if (pathname === '/downloads/Graphite-Orbit-Setup-0.3.0-beta.1.exe') {
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(betaBinary.byteLength)
      })
      res.end(betaBinary)
      return
    }

    res.writeHead(404)
    res.end('Not Found')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  baseUrl = `http://127.0.0.1:${port}`

  return {
    url: baseUrl,
    setPrereleaseAvailable(enabled: boolean) {
      includePrerelease = enabled
    },
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}
