/// <reference types="vite/client" />
import type { Bridge } from '../../shared/contracts'
declare global {
  interface Window {
    orbit: Bridge
  }
}
export {}
