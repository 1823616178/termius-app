import {
  joinRemotePosixPath,
  type SftpConflictDecision,
  type SftpExpandedUploadManifest,
  type SftpTransferItem
} from '../../../shared/sftp'

type LocalUpload = SftpExpandedUploadManifest['files'][number]
type PlannedUpload = LocalUpload & { remotePath: string; conflict: SftpConflictDecision }

export interface UploadConflictChoice {
  decision: SftpConflictDecision | 'cancel'
  applyAll: boolean
}

export async function planUploads(
  files: LocalUpload[],
  directory: string,
  defaultConflict: SftpConflictDecision | 'ask',
  exists: (file: LocalUpload, remotePath: string) => boolean | Promise<boolean>,
  ask: (file: LocalUpload, remotePath: string) => Promise<UploadConflictChoice>
): Promise<PlannedUpload[] | null> {
  let batchDecision = defaultConflict
  const uploads: PlannedUpload[] = []

  for (const file of files) {
    const remotePath = joinRemotePosixPath(directory, file.relativePath)
    let conflict = batchDecision
    if (conflict === 'ask') {
      conflict = 'overwrite'
      if (await exists(file, remotePath)) {
        const choice = await ask(file, remotePath)
        if (choice.decision === 'cancel') return null
        if (choice.applyAll) batchDecision = choice.decision
        if (choice.decision === 'skip') continue
        conflict = choice.decision
      }
    }
    uploads.push({ ...file, remotePath, conflict })
  }
  return uploads
}

export function trimTransferHistory<T extends SftpTransferItem>(items: T[]): T[] {
  const maxCompleted = 200
  if (items.length <= maxCompleted) return items
  let finished = 0
  return items.filter(
    (item) => item.status === 'queued' || item.status === 'running' || ++finished <= maxCompleted
  )
}
