import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  authorizeSender,
  createIpcRegistrar,
  isTrustedRendererUrl,
  type SenderEventLike,
  type WindowLike
} from '../../src/main/ipc-auth'

describe('IPC sender authorization and registrar', () => {
  const rendererPath = join(process.cwd(), 'out/renderer/index.html')
  const fileUrl = pathToFileURL(rendererPath).href

  it('validates dev server origin and packaged file:// URLs strictly', () => {
    expect(isTrustedRendererUrl(`${fileUrl}#tab=1`, { rendererPath })).toBe(true)
    expect(isTrustedRendererUrl(`${fileUrl}?v=2`, { rendererPath })).toBe(true)
    expect(isTrustedRendererUrl('file:///etc/passwd', { rendererPath })).toBe(false)
    expect(isTrustedRendererUrl('https://evil.example.com', { rendererPath })).toBe(false)

    expect(
      isTrustedRendererUrl('http://localhost:5173/index.html', {
        rendererUrl: 'http://localhost:5173',
        rendererPath
      })
    ).toBe(true)
    expect(
      isTrustedRendererUrl('http://localhost:5174/index.html', {
        rendererUrl: 'http://localhost:5173',
        rendererPath
      })
    ).toBe(false)
  })

  it('rejects unknown windows, non-main frames, mismatched webContents, and untrusted URLs', () => {
    const mainFrame = { url: fileUrl }
    const subFrame = { url: fileUrl }
    const owner: WindowLike = {
      id: 1,
      webContents: { mainFrame },
      isFocused: () => true
    }
    const deps = {
      getOwner: (sender: unknown) => (sender === owner.webContents ? owner : null),
      hasWindow: (id: number) => id === 1,
      getMainFrame: (sender: unknown) => (sender === owner.webContents ? mainFrame : null),
      urlConfig: { rendererPath }
    }

    expect(authorizeSender({ sender: owner.webContents, senderFrame: mainFrame }, deps)).toBe(owner)
    expect(() => authorizeSender({ sender: {}, senderFrame: mainFrame }, deps)).toThrow('未授权的请求来源')
    expect(() => authorizeSender({ sender: owner.webContents, senderFrame: subFrame }, deps)).toThrow(
      '未授权的请求来源'
    )
    expect(() =>
      authorizeSender({ sender: owner.webContents, senderFrame: { url: 'https://evil.test' } }, deps)
    ).toThrow('未授权的请求来源')
    expect(() =>
      authorizeSender(
        { sender: owner.webContents, senderFrame: mainFrame },
        { ...deps, hasWindow: () => false }
      )
    ).toThrow('未授权的请求来源')
  })

  it('enforces authorization and schema validation before invoking registered handlers', () => {
    const handlers = new Map<string, (event: SenderEventLike, ...args: unknown[]) => unknown>()
    const listeners = new Map<string, (event: SenderEventLike, ...args: unknown[]) => unknown>()
    let focused = true
    const owner: WindowLike = { id: 7, webContents: {}, isFocused: () => focused }

    const registrar = createIpcRegistrar(
      {
        handle: (channel, listener) => handlers.set(channel, listener),
        on: (channel, listener) => listeners.set(channel, listener)
      },
      (event) => {
        if (event.sender !== owner.webContents) throw new Error('未授权的请求来源')
        return owner
      }
    )

    const schemaSpy = vi.fn((input: { name: string }, win: WindowLike) => `${win.id}:${input.name}`)
    registrar.handleSchema('test:save', z.object({ name: z.string().min(1) }).strict(), schemaSpy, {
      requireFocused: true
    })
    registrar.handle('test:ping', (win) => `pong:${win.id}`)
    const onSpy = vi.fn()
    registrar.on('test:event', onSpy)

    // Unauthorized sender must never reach schema validation or handler
    expect(() => handlers.get('test:save')!({ sender: {}, senderFrame: null }, { name: 'ok' })).toThrow(
      '未授权的请求来源'
    )
    expect(schemaSpy).not.toHaveBeenCalled()

    // Unfocused window blocked when requireFocused is enabled
    focused = false
    expect(() =>
      handlers.get('test:save')!({ sender: owner.webContents, senderFrame: null }, { name: 'ok' })
    ).toThrow('请先聚焦工作台窗口')

    // Invalid payload rejected by Zod schema before handler execution
    focused = true
    expect(() =>
      handlers.get('test:save')!({ sender: owner.webContents, senderFrame: null }, { name: '' })
    ).toThrow()
    expect(schemaSpy).not.toHaveBeenCalled()

    // Valid authorized call passes parsed payload and owner window
    expect(
      handlers.get('test:save')!({ sender: owner.webContents, senderFrame: null }, { name: 'Orbit' })
    ).toBe('7:Orbit')
    expect(handlers.get('test:ping')!({ sender: owner.webContents, senderFrame: null })).toBe('pong:7')

    listeners.get('test:event')!({ sender: owner.webContents, senderFrame: null }, 'minimize')
    expect(onSpy).toHaveBeenCalledWith('minimize', owner, { sender: owner.webContents, senderFrame: null })
  })
})
