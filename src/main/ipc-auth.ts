import { pathToFileURL } from 'node:url'
import type { z } from 'zod'

export interface TrustedUrlConfig {
  rendererUrl?: string
  rendererPath: string
}

export interface SenderFrameLike {
  url: string
}

export interface SenderEventLike {
  sender: unknown
  senderFrame: SenderFrameLike | null
}

export interface WindowLike {
  id: number
  webContents: unknown
  isFocused(): boolean
}

export function isTrustedRendererUrl(url: string, config: TrustedUrlConfig): boolean {
  try {
    return config.rendererUrl
      ? new URL(url).origin === new URL(config.rendererUrl).origin
      : url.split(/[?#]/)[0] === pathToFileURL(config.rendererPath).href
  } catch {
    return false
  }
}

export function authorizeSender<TWindow extends WindowLike>(
  event: SenderEventLike,
  deps: {
    getOwner(sender: unknown): TWindow | null | undefined
    hasWindow(id: number): boolean
    getMainFrame(sender: unknown): SenderFrameLike | null | undefined
    urlConfig: TrustedUrlConfig
  }
): TWindow {
  const owner = deps.getOwner(event.sender)
  if (
    !owner ||
    !deps.hasWindow(owner.id) ||
    event.sender !== owner.webContents ||
    !event.senderFrame ||
    event.senderFrame !== deps.getMainFrame(event.sender) ||
    !isTrustedRendererUrl(event.senderFrame.url, deps.urlConfig)
  ) {
    throw new Error('未授权的请求来源')
  }
  return owner
}

export interface IpcRegistrarTarget<TInvokeEvent extends SenderEventLike, TEvent extends SenderEventLike> {
  handle(channel: string, listener: (event: TInvokeEvent, ...args: unknown[]) => unknown): unknown
  on(channel: string, listener: (event: TEvent, ...args: unknown[]) => unknown): unknown
}

export function createIpcRegistrar<
  TWindow extends WindowLike,
  TInvokeEvent extends SenderEventLike,
  TEvent extends SenderEventLike
>(target: IpcRegistrarTarget<TInvokeEvent, TEvent>, authorize: (event: TInvokeEvent | TEvent) => TWindow) {
  function assertFocusIfRequired(owner: TWindow, requireFocused?: boolean): void {
    if (requireFocused && !owner.isFocused()) {
      throw new Error('请先聚焦工作台窗口')
    }
  }

  return {
    handle<TResult>(
      channel: string,
      handler: (owner: TWindow, event: TInvokeEvent) => TResult,
      options?: { requireFocused?: boolean }
    ): void {
      target.handle(channel, (event) => {
        const owner = authorize(event)
        assertFocusIfRequired(owner, options?.requireFocused)
        return handler(owner, event)
      })
    },
    handleSchema<TSchema extends z.ZodTypeAny, TResult>(
      channel: string,
      schema: TSchema,
      handler: (input: z.output<TSchema>, owner: TWindow, event: TInvokeEvent) => TResult,
      options?: { requireFocused?: boolean }
    ): void {
      target.handle(channel, (event, raw) => {
        const owner = authorize(event)
        assertFocusIfRequired(owner, options?.requireFocused)
        const input = schema.parse(raw)
        return handler(input, owner, event)
      })
    },
    on(channel: string, handler: (arg: unknown, owner: TWindow, event: TEvent) => void): void {
      target.on(channel, (event, arg) => {
        const owner = authorize(event)
        handler(arg, owner, event)
      })
    }
  }
}
