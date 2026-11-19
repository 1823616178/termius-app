import { expect, it, vi } from 'vitest'
import { planUploads, trimTransferHistory } from '../../src/renderer/src/services/file-transfers'
import type { SftpTransferItem, SftpTransferStatus } from '../../src/shared/sftp'

const files = ['new.txt', 'existing.txt', 'other.txt'].map((name) => ({
  name,
  localPath: `/local/${name}`,
  relativePath: name,
  size: 10
}))

it('passes a configured skip policy to the worker for every file without preflight', async () => {
  const exists = vi.fn()
  const ask = vi.fn()
  const uploads = await planUploads(files, '/remote', 'skip', exists, ask)

  expect(uploads?.map(({ name, conflict }) => [name, conflict])).toEqual([
    ['new.txt', 'skip'],
    ['existing.txt', 'skip'],
    ['other.txt', 'skip']
  ])
  expect(exists).not.toHaveBeenCalled()
  expect(ask).not.toHaveBeenCalled()
})

it('applies skip to later conflicts while keeping subsequent new files eligible for upload', async () => {
  const exists = vi.fn((_file, path: string) => path === '/remote/existing.txt')
  const ask = vi.fn().mockResolvedValue({ decision: 'skip', applyAll: true })
  const uploads = await planUploads(files, '/remote', 'ask', exists, ask)

  expect(uploads?.map(({ remotePath, conflict }) => [remotePath, conflict])).toEqual([
    ['/remote/new.txt', 'overwrite'],
    ['/remote/other.txt', 'skip']
  ])
  expect(ask).toHaveBeenCalledOnce()
})

it('discards the whole batch if a later conflict is cancelled', async () => {
  const ask = vi.fn().mockResolvedValue({ decision: 'cancel', applyAll: false })
  const uploads = await planUploads(files, '/remote', 'ask', (file) => file === files[1], ask)

  expect(uploads).toBeNull()
  expect(ask).toHaveBeenCalledWith(files[1], '/remote/existing.txt')
})

it('keeps all queued and running items while capping finished history', () => {
  const item = (id: string, status: SftpTransferStatus): SftpTransferItem => ({
    id,
    status,
    sessionId: 'session',
    direction: 'upload',
    name: id,
    localPath: `/local/${id}`,
    remotePath: `/remote/${id}`,
    totalBytes: 10,
    transferredBytes: 0,
    speedBps: 0,
    startedAt: 0,
    updatedAt: 0
  })
  const queued = Array.from({ length: 201 }, (_, i) => item(`queued-${i}`, 'queued'))
  const finished = Array.from({ length: 201 }, (_, i) => item(`finished-${i}`, 'completed'))
  const running = item('running', 'running')

  expect(trimTransferHistory([...finished, ...queued, running])).toEqual([
    ...finished.slice(0, 200),
    ...queued,
    running
  ])
})
