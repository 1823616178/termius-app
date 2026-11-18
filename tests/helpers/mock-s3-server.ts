import { createHash, randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

interface StoredObject {
  body: Buffer
  lastModified: Date
  etag: string
}

interface MultipartSession {
  key: string
  parts: Map<number, Buffer>
}

export interface MockS3ServerHandle {
  url: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  listKeys(): string[]
  activeUploadCount(): number
  close(): Promise<void>
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function readAllBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function extractXmlTags(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g')
  const matches: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    matches.push(m[1] ?? '')
  }
  return matches
}

export async function startMockS3Server(options?: {
  bucket?: string
  accessKeyId?: string
  secretAccessKey?: string
}): Promise<MockS3ServerHandle> {
  const bucket = options?.bucket ?? 'orbit-test-bucket'
  const accessKeyId = options?.accessKeyId ?? 'AKIAORBITTEST123'
  const secretAccessKey = options?.secretAccessKey ?? 'SuperSecretS3Key!987'
  const store = new Map<string, StoredObject>()
  const uploads = new Map<string, MultipartSession>()

  function authOk(req: IncomingMessage): boolean {
    const auth = req.headers.authorization ?? ''
    if (!auth) return false
    // AWS Signature V4 header starts with `AWS4-HMAC-SHA256 Credential=<ak>/...`
    const m = /Credential=([^/,\s]+)\//.exec(auth)
    return m ? m[1] === accessKeyId : auth.includes(accessKeyId)
  }

  function sendXml(
    res: ServerResponse,
    status: number,
    xml: string,
    headers: Record<string, string> = {}
  ): void {
    const body = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`, 'utf8')
    res.writeHead(status, {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Length': String(body.byteLength),
      ...headers
    })
    res.end(body)
  }

  function sendAccessDenied(res: ServerResponse): void {
    sendXml(
      res,
      403,
      '<Error><Code>InvalidAccessKeyId</Code><Message>The AWS Access Key Id you provided does not exist.</Message></Error>'
    )
  }

  const server = createServer(async (req, res) => {
    try {
      if (!authOk(req)) {
        sendAccessDenied(res)
        return
      }
      const reqUrl = new URL(req.url ?? '/', 'http://127.0.0.1')
      const pathname = reqUrl.pathname
      const bucketPrefix = `/${bucket}`
      if (!pathname.startsWith(bucketPrefix)) {
        sendXml(res, 404, '<Error><Code>NoSuchBucket</Code><Message>Bucket not found</Message></Error>')
        return
      }
      const rawKeyPart = pathname.slice(bucketPrefix.length).replace(/^\/+/, '')
      const key = rawKeyPart ? decodeURIComponent(rawKeyPart) : ''
      const method = (req.method ?? 'GET').toUpperCase()

      // Bucket-level requests (`GET /bucket?list-type=2` or `POST /bucket?delete`)
      if (!key) {
        if (method === 'GET' && reqUrl.searchParams.get('list-type') === '2') {
          const prefix = reqUrl.searchParams.get('prefix') ?? ''
          const delimiter = reqUrl.searchParams.get('delimiter') ?? ''
          const maxKeys = Math.min(1000, Number(reqUrl.searchParams.get('max-keys') ?? '1000') || 1000)
          const token = Number(reqUrl.searchParams.get('continuation-token') ?? '0') || 0

          const allKeys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort()
          const dirSet = new Set<string>()
          const items: Array<
            { type: 'prefix'; value: string } | { type: 'object'; key: string; obj: StoredObject }
          > = []

          for (const k of allKeys) {
            const rest = k.slice(prefix.length)
            if (delimiter && rest.includes(delimiter)) {
              const idx = rest.indexOf(delimiter)
              const cp = `${prefix}${rest.slice(0, idx + delimiter.length)}`
              if (!dirSet.has(cp)) {
                dirSet.add(cp)
                items.push({ type: 'prefix', value: cp })
              }
            } else {
              items.push({ type: 'object', key: k, obj: store.get(k)! })
            }
          }

          const slice = items.slice(token, token + maxKeys)
          const isTruncated = token + maxKeys < items.length
          const nextToken = isTruncated ? String(token + maxKeys) : ''

          const contentsXml = slice
            .filter((i): i is { type: 'object'; key: string; obj: StoredObject } => i.type === 'object')
            .map(
              (i) =>
                `<Contents><Key>${escapeXml(i.key)}</Key><LastModified>${i.obj.lastModified.toISOString()}</LastModified><ETag>"${i.obj.etag}"</ETag><Size>${i.obj.body.byteLength}</Size></Contents>`
            )
            .join('')

          const prefixesXml = slice
            .filter((i): i is { type: 'prefix'; value: string } => i.type === 'prefix')
            .map((i) => `<CommonPrefixes><Prefix>${escapeXml(i.value)}</Prefix></CommonPrefixes>`)
            .join('')

          sendXml(
            res,
            200,
            `<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">` +
              `<Name>${escapeXml(bucket)}</Name>` +
              `<Prefix>${escapeXml(prefix)}</Prefix>` +
              (delimiter ? `<Delimiter>${escapeXml(delimiter)}</Delimiter>` : '') +
              `<KeyCount>${slice.length}</KeyCount>` +
              `<MaxKeys>${maxKeys}</MaxKeys>` +
              `<IsTruncated>${isTruncated}</IsTruncated>` +
              (nextToken ? `<NextContinuationToken>${nextToken}</NextContinuationToken>` : '') +
              contentsXml +
              prefixesXml +
              `</ListBucketResult>`
          )
          return
        }

        if (method === 'POST' && reqUrl.searchParams.has('delete')) {
          const xml = (await readAllBody(req)).toString('utf8')
          const keys = extractXmlTags(xml, 'Key').map((k) =>
            k.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>')
          )
          const deletedXml = keys
            .map((k) => {
              store.delete(k)
              return `<Deleted><Key>${escapeXml(k)}</Key></Deleted>`
            })
            .join('')
          sendXml(res, 200, `<DeleteResult>${deletedXml}</DeleteResult>`)
          return
        }

        res.writeHead(400).end('Unsupported bucket request')
        return
      }

      // Multipart initiate
      if (method === 'POST' && reqUrl.searchParams.has('uploads')) {
        await readAllBody(req)
        const uploadId = randomUUID()
        uploads.set(uploadId, { key, parts: new Map() })
        sendXml(
          res,
          200,
          `<InitiateMultipartUploadResult><Bucket>${escapeXml(bucket)}</Bucket><Key>${escapeXml(key)}</Key><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`
        )
        return
      }

      // Multipart complete
      if (method === 'POST' && reqUrl.searchParams.has('uploadId')) {
        const uploadId = reqUrl.searchParams.get('uploadId') ?? ''
        const session = uploads.get(uploadId)
        await readAllBody(req)
        if (!session) {
          sendXml(res, 404, '<Error><Code>NoSuchUpload</Code><Message>Upload not found</Message></Error>')
          return
        }
        const sortedParts = [...session.parts.entries()].sort((a, b) => a[0] - b[0]).map(([, buf]) => buf)
        const merged = Buffer.concat(sortedParts)
        const etag = createHash('md5').update(merged).digest('hex')
        store.set(session.key, { body: merged, lastModified: new Date(), etag })
        uploads.delete(uploadId)
        sendXml(
          res,
          200,
          `<CompleteMultipartUploadResult><Bucket>${escapeXml(bucket)}</Bucket><Key>${escapeXml(session.key)}</Key><ETag>"${etag}"</ETag></CompleteMultipartUploadResult>`
        )
        return
      }

      // Multipart abort
      if (method === 'DELETE' && reqUrl.searchParams.has('uploadId')) {
        const uploadId = reqUrl.searchParams.get('uploadId') ?? ''
        uploads.delete(uploadId)
        res.writeHead(204).end()
        return
      }

      // Multipart upload part
      if (method === 'PUT' && reqUrl.searchParams.has('uploadId') && reqUrl.searchParams.has('partNumber')) {
        const uploadId = reqUrl.searchParams.get('uploadId') ?? ''
        const partNumber = Number(reqUrl.searchParams.get('partNumber'))
        const body = await readAllBody(req)
        const session = uploads.get(uploadId)
        if (!session) {
          sendXml(res, 404, '<Error><Code>NoSuchUpload</Code><Message>Upload not found</Message></Error>')
          return
        }
        session.parts.set(partNumber, body)
        const etag = createHash('md5').update(body).digest('hex')
        res.writeHead(200, { ETag: `"${etag}"` }).end()
        return
      }

      // CopyObject (`PUT` with `x-amz-copy-source`)
      if (method === 'PUT' && req.headers['x-amz-copy-source']) {
        await readAllBody(req)
        const copySource = decodeURIComponent(String(req.headers['x-amz-copy-source'])).replace(/^\/+/, '')
        const slashIdx = copySource.indexOf('/')
        const srcKey = slashIdx >= 0 ? copySource.slice(slashIdx + 1) : copySource
        const existing = store.get(srcKey)
        if (!existing) {
          sendXml(res, 404, '<Error><Code>NoSuchKey</Code><Message>Source not found</Message></Error>')
          return
        }
        const etag = existing.etag
        const now = new Date()
        store.set(key, { body: Buffer.from(existing.body), lastModified: now, etag })
        sendXml(
          res,
          200,
          `<CopyObjectResult><LastModified>${now.toISOString()}</LastModified><ETag>"${etag}"</ETag></CopyObjectResult>`
        )
        return
      }

      // PutObject
      if (method === 'PUT') {
        const body = await readAllBody(req)
        const etag = createHash('md5').update(body).digest('hex')
        store.set(key, { body, lastModified: new Date(), etag })
        res.writeHead(200, { ETag: `"${etag}"` }).end()
        return
      }

      // HeadObject / GetObject
      if (method === 'HEAD' || method === 'GET') {
        const existing = store.get(key)
        if (!existing) {
          res.writeHead(404).end()
          return
        }
        res.writeHead(200, {
          'Content-Length': String(existing.body.byteLength),
          'Last-Modified': existing.lastModified.toUTCString(),
          ETag: `"${existing.etag}"`,
          'Content-Type': 'application/octet-stream'
        })
        if (method === 'HEAD') res.end()
        else res.end(existing.body)
        return
      }

      // DeleteObject
      if (method === 'DELETE') {
        store.delete(key)
        res.writeHead(204).end()
        return
      }

      res.writeHead(405).end()
    } catch {
      if (!res.headersSent) res.writeHead(500).end('Internal error')
    }
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}`,
    bucket,
    accessKeyId,
    secretAccessKey,
    listKeys: () => [...store.keys()],
    activeUploadCount: () => uploads.size,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
