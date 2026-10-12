import '@testing-library/jest-dom/vitest'

if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

import { beforeEach, afterEach } from 'vitest'
import { setSessionMemory } from '../features/auth/session'
import { testSession } from './auth-fixture'
beforeEach(()=>setSessionMemory(testSession))
afterEach(()=>setSessionMemory(null))
