import { parentPort } from 'node:worker_threads'
import { argon2idSync } from './argon2id'

interface KdfRequest {
  id: string
  password: Uint8Array
  salt: Uint8Array
  memoryKiB: number
  passes: number
  parallelism: number
  tagLength: number
}

parentPort?.on('message', (req: KdfRequest) => {
  try {
    const key = argon2idSync({
      password: req.password,
      salt: req.salt,
      memoryKiB: req.memoryKiB,
      passes: req.passes,
      parallelism: req.parallelism,
      tagLength: req.tagLength
    })
    parentPort?.postMessage({ id: req.id, key }, [key.buffer as ArrayBuffer])
  } catch (error) {
    parentPort?.postMessage({
      id: req.id,
      error: error instanceof Error ? error.message : 'Argon2id 密钥派生失败'
    })
  } finally {
    req.password.fill(0)
    req.salt.fill(0)
  }
})
