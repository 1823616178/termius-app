import { generateKeyPairSync } from 'node:crypto'
import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readlink,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
  writeFile,
  type FileHandle
} from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import type { AddressInfo } from 'node:net'
import { Server, utils, type Attributes, type Connection, type FileEntry, type SFTPWrapper } from 'ssh2'

const { STATUS_CODE, flagsToString } = utils.sftp

const HOME_POSIX = '/home/orbit'

interface OpenHandleState {
  kind: 'dir' | 'file'
  posixPath: string
  fsPath: string
  entries?: FileEntry[]
  dirSent?: boolean
  fh?: FileHandle
}

export interface MockSftpSshServer {
  host: string
  port: number
  rootDir: string
  homeDir: string
  username: string
  password: string
  close(): Promise<void>
}

function formatLongname(name: string, st: Stats, mode: number): string {
  const isDir = st.isDirectory()
  const typeChar = isDir ? 'd' : st.isSymbolicLink() ? 'l' : '-'
  const bits = mode & 0o777
  const rwx = [
    bits & 0o400 ? 'r' : '-',
    bits & 0o200 ? 'w' : '-',
    bits & 0o100 ? 'x' : '-',
    bits & 0o040 ? 'r' : '-',
    bits & 0o020 ? 'w' : '-',
    bits & 0o010 ? 'x' : '-',
    bits & 0o004 ? 'r' : '-',
    bits & 0o002 ? 'w' : '-',
    bits & 0o001 ? 'x' : '-'
  ].join('')
  return `${typeChar}${rwx} 1 orbit orbit ${String(st.size).padStart(8, ' ')} Nov 16 12:00 ${name}`
}

export async function startMockSftpSshServer(options?: {
  username?: string
  password?: string
}): Promise<MockSftpSshServer> {
  const username = options?.username ?? 'orbit'
  const password = options?.password ?? 'SftpTest!2026'
  const rootDir = await mkdtemp(join(tmpdir(), 'orbit-sftp-srv-'))
  const homeDir = join(rootDir, 'home', 'orbit')
  await mkdir(join(homeDir, 'projects', 'app'), { recursive: true })
  await writeFile(join(homeDir, 'readme.txt'), 'Hello Orbit SFTP\nLine 2\n', 'utf8')
  await writeFile(join(homeDir, '.env'), 'ORBIT_SECRET=1\n', 'utf8')
  await writeFile(join(homeDir, 'empty.bin'), Buffer.alloc(0))
  await writeFile(join(homeDir, 'projects', 'deploy.sh'), '#!/bin/sh\necho ok\n', 'utf8')
  await writeFile(join(homeDir, 'projects', 'app', 'config.json'), '{"port":8080}\n', 'utf8')

  const customModes = new Map<string, number>()
  const hostKey = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' }
  }).privateKey

  const resolvePosixAndFs = (rawPath: string): { posixPath: string; fsPath: string } => {
    let target = (rawPath || '.').replaceAll('\\', '/')
    if (target === '.' || target === '~') target = HOME_POSIX
    else if (target.startsWith('~/')) target = `${HOME_POSIX}/${target.slice(2)}`
    else if (target.startsWith('./')) target = `${HOME_POSIX}/${target.slice(2)}`
    else if (!target.startsWith('/')) target = `${HOME_POSIX}/${target}`
    const normalized = posix.resolve('/', target)
    const parts = normalized.split('/').filter(Boolean)
    return {
      posixPath: normalized,
      fsPath: parts.length ? join(rootDir, ...parts) : rootDir
    }
  }

  const buildAttrs = (posixPath: string, st: Stats): Attributes => {
    const fileTypeBits = st.isDirectory() ? 0o040000 : st.isSymbolicLink() ? 0o120000 : 0o100000
    const permBits = customModes.get(posixPath) ?? (st.isDirectory() ? 0o755 : 0o644)
    return {
      mode: fileTypeBits | permBits,
      uid: 1000,
      gid: 1000,
      size: st.isDirectory() ? 4096 : st.size,
      atime: Math.floor(st.atimeMs / 1000),
      mtime: Math.floor(st.mtimeMs / 1000)
    }
  }

  const allHandles = new Set<OpenHandleState>()

  const attachSftp = (sftp: SFTPWrapper) => {
    const handles = new Map<string, OpenHandleState>()
    let nextId = 1

    const allocHandle = (state: OpenHandleState): Buffer => {
      const id = String(nextId++)
      handles.set(id, state)
      allHandles.add(state)
      return Buffer.from(id, 'utf8')
    }

    const sendFsError = (reqID: number, error: unknown) => {
      const code = (error as NodeJS.ErrnoException)?.code
      if (code === 'ENOENT') sftp.status(reqID, STATUS_CODE.NO_SUCH_FILE, 'No such file')
      else if (code === 'EACCES' || code === 'EPERM')
        sftp.status(reqID, STATUS_CODE.PERMISSION_DENIED, 'Permission denied')
      else sftp.status(reqID, STATUS_CODE.FAILURE, (error as Error)?.message ?? 'Failure')
    }

    sftp.on('close', () => {
      for (const state of handles.values()) {
        allHandles.delete(state)
        void state.fh?.close().catch(() => {})
      }
      handles.clear()
    })

    sftp.on('REALPATH', (reqID, path) => {
      const { posixPath } = resolvePosixAndFs(path)
      sftp.name(reqID, [
        {
          filename: posixPath,
          longname: posixPath,
          attrs: { mode: 0o040755, uid: 1000, gid: 1000, size: 4096, atime: 1700000000, mtime: 1700000000 }
        }
      ])
    })

    const handleStat = async (reqID: number, rawPath: string, followSymlinks: boolean) => {
      try {
        const { posixPath, fsPath } = resolvePosixAndFs(rawPath)
        const st = followSymlinks ? await stat(fsPath) : await lstat(fsPath)
        sftp.attrs(reqID, buildAttrs(posixPath, st))
      } catch (err) {
        sendFsError(reqID, err)
      }
    }

    sftp.on('STAT', (reqID, path) => void handleStat(reqID, path, true))
    sftp.on('LSTAT', (reqID, path) => void handleStat(reqID, path, false))

    sftp.on('READLINK', async (reqID, path) => {
      try {
        const { fsPath } = resolvePosixAndFs(path)
        const target = await readlink(fsPath)
        sftp.name(reqID, [
          {
            filename: target,
            longname: target,
            attrs: {
              mode: 0o120777,
              uid: 1000,
              gid: 1000,
              size: target.length,
              atime: 1700000000,
              mtime: 1700000000
            }
          }
        ])
      } catch (err) {
        sendFsError(reqID, err)
      }
    })

    sftp.on('OPENDIR', async (reqID, path) => {
      try {
        const { posixPath, fsPath } = resolvePosixAndFs(path)
        const st = await stat(fsPath)
        if (!st.isDirectory()) {
          sftp.status(reqID, STATUS_CODE.FAILURE, 'Not a directory')
          return
        }
        const names = await readdir(fsPath)
        const entries = await Promise.all(
          names.map(async (name) => {
            const childPosix = posix.join(posixPath, name)
            const childFs = join(fsPath, name)
            const childStat = await lstat(childFs)
            const attrs = buildAttrs(childPosix, childStat)
            return {
              filename: name,
              longname: formatLongname(name, childStat, attrs.mode),
              attrs
            }
          })
        )
        sftp.handle(
          reqID,
          allocHandle({
            kind: 'dir',
            posixPath,
            fsPath,
            entries,
            dirSent: false
          })
        )
      } catch (err) {
        sendFsError(reqID, err)
      }
    })

    sftp.on('READDIR', (reqID, handle) => {
      const state = handles.get(handle.toString('utf8'))
      if (!state || state.kind !== 'dir') {
        sftp.status(reqID, STATUS_CODE.FAILURE, 'Invalid directory handle')
        return
      }
      if (state.dirSent) {
        sftp.status(reqID, STATUS_CODE.EOF)
        return
      }
      state.dirSent = true
      sftp.name(reqID, state.entries ?? [])
    })

    sftp.on('OPEN', async (reqID, filename, pflags, attrs) => {
      try {
        const { posixPath, fsPath } = resolvePosixAndFs(filename)
        const modeFlags = flagsToString(pflags) ?? 'r'
        const fh = await open(fsPath, modeFlags, 0o644)
        if (attrs?.mode) {
          customModes.set(posixPath, attrs.mode & 0o7777)
        }
        sftp.handle(reqID, allocHandle({ kind: 'file', posixPath, fsPath, fh }))
      } catch (err) {
        sendFsError(reqID, err)
      }
    })

    sftp.on('READ', async (reqID, handle, offset, len) => {
      const state = handles.get(handle.toString('utf8'))
      if (!state?.fh) {
        sftp.status(reqID, STATUS_CODE.FAILURE, 'Invalid file handle')
        return
      }
      try {
        const buf = Buffer.allocUnsafe(Math.max(1, len))
        const { bytesRead } = await state.fh.read(buf, 0, len, Number(offset))
        if (bytesRead === 0) {
          sftp.status(reqID, STATUS_CODE.EOF)
        } else {
          sftp.data(reqID, buf.subarray(0, bytesRead))
        }
      } catch (err) {
        sendFsError(reqID, err)
      }
    })

    sftp.on('WRITE', async (reqID, handle, offset, data) => {
      const state = handles.get(handle.toString('utf8'))
      if (!state?.fh) {
        sftp.status(reqID, STATUS_CODE.FAILURE, 'Invalid file handle')
        return
      }
      try {
        await state.fh.write(data, 0, data.length, Number(offset))
        sftp.status(reqID, STATUS_CODE.OK)
      } catch (err) {
        sendFsError(reqID, err)
      }
    })

    sftp.on('FSTAT', async (reqID, handle) => {
      const state = handles.get(handle.toString('utf8'))
      if (!state?.fh) {
        sftp.status(reqID, STATUS_CODE.FAILURE, 'Invalid file handle')
        return
      }
      try {
        const st = await state.fh.stat()
        sftp.attrs(reqID, buildAttrs(state.posixPath, st))
      } catch (err) {
        sendFsError(reqID, err)
      }
    })

    sftp.on('SETSTAT', async (reqID, path, attrs) => {
      try {
        const { posixPath, fsPath } = resolvePosixAndFs(path)
        await stat(fsPath)
        if (typeof attrs.mode === 'number') {
          customModes.set(posixPath, attrs.mode & 0o7777)
        }
        sftp.status(reqID, STATUS_CODE.OK)
      } catch (err) {
        sendFsError(reqID, err)
      }
    })

    sftp.on('FSETSTAT', (reqID, handle, attrs) => {
      const state = handles.get(handle.toString('utf8'))
      if (!state) {
        sftp.status(reqID, STATUS_CODE.FAILURE, 'Invalid handle')
        return
      }
      if (typeof attrs.mode === 'number') {
        customModes.set(state.posixPath, attrs.mode & 0o7777)
      }
      sftp.status(reqID, STATUS_CODE.OK)
    })

    sftp.on('MKDIR', async (reqID, path, attrs) => {
      try {
        const { posixPath, fsPath } = resolvePosixAndFs(path)
        await mkdir(fsPath)
        if (typeof attrs?.mode === 'number' && attrs.mode > 0) {
          customModes.set(posixPath, attrs.mode & 0o7777)
        }
        sftp.status(reqID, STATUS_CODE.OK)
      } catch (err) {
        sendFsError(reqID, err)
      }
    })

    sftp.on('REMOVE', async (reqID, path) => {
      try {
        const { posixPath, fsPath } = resolvePosixAndFs(path)
        await unlink(fsPath)
        customModes.delete(posixPath)
        sftp.status(reqID, STATUS_CODE.OK)
      } catch (err) {
        sendFsError(reqID, err)
      }
    })

    sftp.on('RMDIR', async (reqID, path) => {
      try {
        const { posixPath, fsPath } = resolvePosixAndFs(path)
        await rmdir(fsPath)
        customModes.delete(posixPath)
        sftp.status(reqID, STATUS_CODE.OK)
      } catch (err) {
        sendFsError(reqID, err)
      }
    })

    sftp.on('RENAME', async (reqID, oldPath, newPath) => {
      try {
        const src = resolvePosixAndFs(oldPath)
        const dst = resolvePosixAndFs(newPath)
        const exists = await lstat(dst.fsPath).then(
          () => true,
          () => false
        )
        if (exists) {
          sftp.status(reqID, STATUS_CODE.FAILURE, 'Destination exists')
          return
        }
        await rename(src.fsPath, dst.fsPath)
        const prevMode = customModes.get(src.posixPath)
        customModes.delete(src.posixPath)
        if (prevMode !== undefined) customModes.set(dst.posixPath, prevMode)
        sftp.status(reqID, STATUS_CODE.OK)
      } catch (err) {
        sendFsError(reqID, err)
      }
    })

    sftp.on('CLOSE', async (reqID, handle) => {
      const id = handle.toString('utf8')
      const state = handles.get(id)
      handles.delete(id)
      if (state) {
        allHandles.delete(state)
        await state.fh?.close().catch(() => {})
      }
      sftp.status(reqID, STATUS_CODE.OK)
    })
  }

  const connections = new Set<Connection>()
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    connections.add(client)
    client.on('error', () => {})
    client.on('close', () => connections.delete(client))
    client.on('authentication', (ctx) => {
      if (ctx.method === 'password' && ctx.username === username && ctx.password === password) {
        ctx.accept()
      } else {
        ctx.reject(['password'])
      }
    })
    client.on('ready', () => {
      client.on('session', (accept) => {
        const session = accept()
        session.on('error', () => {})
        session.on('pty', (acceptPty) => acceptPty?.())
        session.on('shell', (acceptShell) => {
          const stream = acceptShell()
          stream.on('error', () => {})
          stream.write('orbit@mock-sftp:~$ ')
          stream.on('data', (chunk: Buffer) => {
            stream.write(chunk)
          })
        })
        session.on('sftp', (acceptSftp) => {
          const sftp = acceptSftp()
          sftp.on('error', () => {})
          attachSftp(sftp)
        })
      })
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (server.address() as AddressInfo).port

  return {
    host: '127.0.0.1',
    port,
    rootDir,
    homeDir,
    username,
    password,
    async close() {
      for (const conn of connections) {
        conn.end()
      }
      for (const state of allHandles) {
        await state.fh?.close().catch(() => {})
      }
      allHandles.clear()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(rootDir, { recursive: true, force: true })
    }
  }
}
