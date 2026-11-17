import { utilityProcess, type UtilityProcess } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

export class DataClient {
  private worker: UtilityProcess
  private exited = false
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout }
  >()
  readonly ready: Promise<void>

  constructor(databasePath: string, onStderr?: (message: string) => void) {
    this.worker = utilityProcess.fork(join(__dirname, 'data-worker.js'), [databasePath], {
      serviceName: 'Orbit Data',
      stdio: 'pipe'
    })
    this.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('本地数据库初始化超时')), 15_000)
      this.worker.on('message', (data) => {
        if (data.ready) {
          clearTimeout(timeout)
          resolve()
          return
        }
        const request = this.pending.get(data.id)
        if (!request) return
        clearTimeout(request.timer)
        this.pending.delete(data.id)
        if (data.error) request.reject(new Error(data.error))
        else request.resolve(data.value)
      })
      this.worker.on('exit', () => {
        this.exited = true
        clearTimeout(timeout)
        reject(new Error('本地数据进程已退出'))
        for (const request of this.pending.values()) {
          clearTimeout(request.timer)
          request.reject(new Error('本地数据进程已退出，请重启应用。'))
        }
        this.pending.clear()
      })
      this.worker.stderr?.on('data', (chunk: Buffer) => {
        onStderr?.(chunk.toString('utf8'))
      })
    })
  }

  async call<T>(method: string, ...args: unknown[]): Promise<T> {
    await this.ready
    const timeoutMs =
      method === 'vaultCreate' ||
      method === 'vaultUnlock' ||
      method === 'vaultRecover' ||
      method === 'syncPrepareRotate'
        ? 30_000
        : 10_000
    return new Promise<T>((resolve, reject) => {
      const id = randomUUID()
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('本地数据操作超时，请重试。'))
      }, timeoutMs)
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      this.worker.postMessage({ id, method, args })
    })
  }

  shutdown(): Promise<void> {
    if (this.exited) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        this.worker.kill()
        resolve()
      }, 2000)
      this.worker.once('exit', () => {
        clearTimeout(timeout)
        resolve()
      })
      this.worker.postMessage({ type: 'shutdown' })
    })
  }

  close(): void {
    if (!this.exited) this.worker.kill()
  }
}
