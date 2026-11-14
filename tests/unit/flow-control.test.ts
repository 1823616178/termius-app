import { describe, expect, it } from 'vitest'
import { OutputWindow } from '../../src/shared/flow-control'
describe('terminal consumption window', () => {
  it('pauses high-volume output until the parser consumes enough bytes', () => {
    const flow = new OutputWindow(100, 25, 300)
    const first = flow.push(80),
      second = flow.push(40)
    expect(flow.shouldPause).toBe(true)
    flow.ack(first)
    expect(flow.shouldResume).toBe(false)
    flow.ack(second)
    expect(flow.bytes).toBe(0)
    expect(flow.shouldResume).toBe(true)
  })
  it('does not grant credits for skipped, duplicate or future acknowledgements', () => {
    const flow = new OutputWindow()
    flow.push(100)
    flow.push(200)
    expect(flow.ack(2)).toBe(false)
    expect(flow.ack(9)).toBe(false)
    expect(flow.bytes).toBe(300)
    expect(flow.ack(1)).toBe(true)
    expect(flow.ack(1)).toBe(false)
    expect(flow.bytes).toBe(200)
    expect(flow.ack(2)).toBe(true)
  })
  it('stops rather than silently losing output after the buffer limit', () => {
    const flow = new OutputWindow(100, 25, 150)
    flow.push(140)
    expect(() => flow.push(11)).toThrow('OUTPUT_OVERFLOW')
    expect(flow.bytes).toBe(140)
  })
})
