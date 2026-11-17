import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import ts from 'typescript'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { argon2idSync } from '../../src/workers/data-crypto/argon2id'
import { runArgon2id, shutdownKdfWorker } from '../../src/workers/data-crypto/kdf-client'

let tempWorkerDir: string | null = null

function resolveWorkerEntryPath(): string {
  const builtPath = resolve('out/main/kdf-worker.js')
  if (existsSync(builtPath)) {
    return builtPath
  }
  const dir = mkdtempSync(join(tmpdir(), 'orbit-kdf-worker-'))
  tempWorkerDir = dir
  writeFileSync(join(dir, 'package.json'), '{"type":"commonjs"}\n', 'utf8')
  const compilerOptions: ts.CompilerOptions = {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true
  }
  for (const name of ['argon2id', 'kdf-worker']) {
    const source = readFileSync(resolve(`src/workers/data-crypto/${name}.ts`), 'utf8')
    const out = ts.transpileModule(source, { compilerOptions })
    writeFileSync(join(dir, `${name}.js`), out.outputText, 'utf8')
  }
  return join(dir, 'kdf-worker.js')
}

describe('kdf-client', () => {
  afterEach(async () => {
    await shutdownKdfWorker()
  })

  afterAll(() => {
    if (tempWorkerDir) {
      rmSync(tempWorkerDir, { recursive: true, force: true })
      tempWorkerDir = null
    }
  })

  it('falls back to synchronous argon2id when worker script does not exist', async () => {
    const password = new TextEncoder().encode('fallback-password')
    const salt = new TextEncoder().encode('fallback-salt-16')
    const params = {
      password,
      salt,
      memoryKiB: 64,
      passes: 2,
      parallelism: 1,
      tagLength: 32
    }

    const derived = await runArgon2id(params, resolve('out/main/__missing_kdf_worker__.js'))
    const expected = argon2idSync(params)

    expect(Buffer.from(derived).equals(Buffer.from(expected))).toBe(true)
    expect(Buffer.from(password).toString('utf8')).toBe('fallback-password')
    expect(Buffer.from(salt).toString('utf8')).toBe('fallback-salt-16')
  })

  it('derives identical keys inside worker_threads without mutating caller buffers and supports restart after shutdown', async () => {
    const workerPath = resolveWorkerEntryPath()
    const pwA = new TextEncoder().encode('worker-password-a')
    const saltA = new TextEncoder().encode('worker-salt-0001')
    const pwB = new TextEncoder().encode('worker-password-b')
    const saltB = new TextEncoder().encode('worker-salt-0002')

    const paramsA = { password: pwA, salt: saltA, memoryKiB: 64, passes: 2, parallelism: 1, tagLength: 32 }
    const paramsB = { password: pwB, salt: saltB, memoryKiB: 128, passes: 2, parallelism: 1, tagLength: 32 }

    const [derivedA, derivedB] = await Promise.all([
      runArgon2id(paramsA, workerPath),
      runArgon2id(paramsB, workerPath)
    ])

    expect(Buffer.from(derivedA).equals(Buffer.from(argon2idSync(paramsA)))).toBe(true)
    expect(Buffer.from(derivedB).equals(Buffer.from(argon2idSync(paramsB)))).toBe(true)
    expect(Buffer.from(pwA).toString('utf8')).toBe('worker-password-a')
    expect(Buffer.from(saltB).toString('utf8')).toBe('worker-salt-0002')

    await shutdownKdfWorker()

    // Spawns a fresh worker transparently after explicit shutdown
    const derivedAfterRestart = await runArgon2id(paramsA, workerPath)
    expect(Buffer.from(derivedAfterRestart).equals(Buffer.from(derivedA))).toBe(true)
  })

  it('rejects in-flight worker request cleanly when shutdownKdfWorker interrupts it', async () => {
    const workerPath = resolveWorkerEntryPath()
    const pending = runArgon2id(
      {
        password: new TextEncoder().encode('pending-shutdown'),
        salt: new TextEncoder().encode('salt-for-shutdown'),
        memoryKiB: 8192,
        passes: 4,
        parallelism: 1,
        tagLength: 32
      },
      workerPath
    )
    const assertion = expect(pending).rejects.toThrow('KDF 工作线程正在关闭')

    await shutdownKdfWorker()
    await assertion
  })
})
