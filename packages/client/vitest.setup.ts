import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * Global test setup for the React UI overlay.
 *
 *  - `@testing-library/jest-dom` adds the `toBeInTheDocument()`-style matchers.
 *  - `cleanup()` after each test unmounts trees so the shared `uiStore`
 *    subscribers from one test don't leak into the next.
 *  - The polyfills below cover browser APIs the Radix primitives (Tabs,
 *    Tooltip, Select, …) reach for but jsdom does not implement.
 */
afterEach(() => {
  cleanup();
});

if (!("ResizeObserver" in globalThis)) {
  class ResizeObserver {
    observe(): void {
      /* no-op */
    }
    unobserve(): void {
      /* no-op */
    }
    disconnect(): void {
      /* no-op */
    }
  }
  globalThis.ResizeObserver = ResizeObserver as unknown as typeof globalThis.ResizeObserver;
}

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {
      /* no-op */
    },
    removeListener: () => {
      /* no-op */
    },
    addEventListener: () => {
      /* no-op */
    },
    removeEventListener: () => {
      /* no-op */
    },
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// Radix pointer/scroll APIs used by interactive primitives.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {
    /* no-op */
  };
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {
    /* no-op */
  };
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {
    /* no-op */
  };
}
