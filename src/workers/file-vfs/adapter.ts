import type { SftpConflictDecision, SftpListResult, SftpStatResult } from '../../shared/sftp'
import type { SftpRemoteTreeManifest } from '../../shared/contracts'
import type { FileCapabilities, FileConnectConfig } from '../../shared/files'

/**
 * Contract implemented by every protocol adapter that runs inside the `file-vfs` utility process.
 *
 * Conventions every adapter MUST follow:
 *  - Remote paths are POSIX-style absolute strings using `/` (use helpers from `../../shared/sftp`).
 *    The root `/` is the server root (FTP), the WebDAV base URL path, or the S3 bucket.
 *  - `list()` returns entries whose `path` is the absolute remote path and whose `kind` is
 *    'directory' | 'file' | 'symlink' | 'other'. Fields a protocol cannot provide are 0 / ''.
 *  - Errors are thrown as `Error` with a short, user-readable message (no secrets, no raw stack).
 *  - Nothing here may log or include credentials in error messages.
 *  - Long operations honour `AbortSignal` and clean up partial/temporary data on abort or failure.
 */

export interface TransferProgress {
  transferredBytes: number
  totalBytes: number
}

export interface UploadParams {
  localPath: string
  remotePath: string
  conflict: SftpConflictDecision
  signal: AbortSignal
  /** Bytes per second, 0 = unlimited. */
  speedLimitBps: number
  onProgress(progress: TransferProgress): void
}

export interface DownloadParams {
  remotePath: string
  localPath: string
  conflict: SftpConflictDecision
  signal: AbortSignal
  speedLimitBps: number
  onProgress(progress: TransferProgress): void
}

export interface TransferOutcome {
  /** `skipped` when conflict === 'skip' and the destination already exists. */
  status: 'completed' | 'skipped'
  /** Final destination path (differs from the requested one when conflict === 'rename'). */
  finalPath: string
  bytes: number
}

export interface FileAdapter {
  readonly capabilities: FileCapabilities
  connect(signal?: AbortSignal): Promise<void>
  close(): Promise<void>
  home(): Promise<string>
  list(path: string): Promise<SftpListResult>
  stat(path: string): Promise<SftpStatResult>
  collectTree(path: string): Promise<SftpRemoteTreeManifest>
  mkdir(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  /** `recursive` must delete a non-empty directory (emulated client-side if the protocol lacks it). */
  remove(path: string, recursive: boolean): Promise<void>
  /** Only called when `capabilities.chmod` is true. */
  chmod(path: string, mode: number): Promise<void>
  upload(params: UploadParams): Promise<TransferOutcome>
  download(params: DownloadParams): Promise<TransferOutcome>
}

export type AdapterFactory = (config: FileConnectConfig) => FileAdapter
