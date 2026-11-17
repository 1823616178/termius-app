import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { argon2idSync } from './argon2id'

export interface Argon2idParams {
  password: Uint8Array
  salt: Uint8Array
  memoryKiB: number
  passes: number
  parallelism: number
  tagLength: number
}

interface KdfReply {
  id: string
  key?: Uint8Array
  error?: string
}

let activeWorker: Worker | null = null
const pending = new Map<string, { resolve: (key: Uint8Array) => void; reject: (error: Error) => void }>()

function rejectAllPending(reason: Error): void {
  for (const req of pending.values()) req.reject(reason)
  pending.clear()
}

function getOrCreateWorker(workerPath: string): Worker {
  if (activeWorker) return activeWorker
  const worker = new Worker(workerPath)
  worker.unref()
  worker.on('message', (reply: KdfReply) => {
    const req = pending.get(reply.id)
    if (!req) return
    pending.delete(reply.id)
    if (reply.error || !reply.key) {
      req.reject(new Error(reply.error || 'Argon2id 密钥派生失败'))
      return
    }
    req.resolve(new Uint8Array(reply.key))
  })
  worker.on('error', (error) => {
    if (activeWorker === worker) activeWorker = null
    rejectAllPending(error instanceof Error ? error : new Error('KDF 工作线程异常'))
  })
  worker.on('exit', (code) => {
    if (activeWorker === worker) activeWorker = null
    if (pending.size > 0) {
      rejectAllPending(new Error(`KDF 工作线程已退出 (${code})`))
    }
  })
  activeWorker = worker
  return worker
}

export async function runArgon2id(
  params: Argon2idParams,
  workerPath = join(__dirname, 'kdf-worker.js')
): Promise<Uint8Array> {
  if (!existsSync(workerPath)) {
    return argon2idSync(params)
  }
  let worker: Worker
  try {
    worker = getOrCreateWorker(workerPath)
  } catch {
    return argon2idSync(params)
  }
  const passwordCopy = new Uint8Array(params.password)
  const saltCopy = new Uint8Array(params.salt)
  const id = randomUUID()
  return new Promise<Uint8Array>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    worker.postMessage(
      {
        id,
        password: passwordCopy,
        salt: saltCopy,
        memoryKiB: params.memoryKiB,
        passes: params.passes,
        parallelism: params.parallelism,
        tagLength: params.tagLength
      },
      [passwordCopy.buffer as ArrayBuffer, saltCopy.buffer as ArrayBuffer]
    )
  })
}

export async function shutdownKdfWorker(): Promise<void> {
  const worker = activeWorker
  activeWorker = null
  rejectAllPending(new Error('KDF 工作线程正在关闭'))
  if (worker) {
    await worker.terminate().catch(() => {})
  }
}
