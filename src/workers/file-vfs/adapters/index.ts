import type { FileConnectConfig } from '../../../shared/files'
import type { FileAdapter } from '../adapter'
import { FtpAdapter } from './ftp'
import { S3Adapter } from './s3'
import { WebDavAdapter } from './webdav'

export function createAdapter(config: FileConnectConfig): FileAdapter {
  switch (config.protocol) {
    case 'ftp':
    case 'ftps':
      return new FtpAdapter(config)
    case 'webdav':
      return new WebDavAdapter(config)
    case 's3':
      return new S3Adapter(config)
    case 'smb':
    default:
      throw new Error('该协议在当前版本尚未提供')
  }
}
