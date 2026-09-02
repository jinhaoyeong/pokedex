import { getAppScrollRoot, isMobileAppShell } from "@/lib/app-scroll";

/** Discrete mouse-wheel notches. Pixel-mode trackpads use a shorter constant. */
export const PAGE_SCROLL_SMOOTH_MS = 180;
const PIXEL_SCROLL_SMOOTH_MS = 80;

function readY() {
  if (isMobileAppShell()) {
    const root = getAppScrollRoot();
    if (root) {
      return root.scrollTop;
    }
  }
  return window.scrollY;
}

function writeY(y: number) {
  if (isMobileAppShell()) {
    const root = getAppScrollRoot();
    if (root) {
      root.scrollTop = y;
      return;
    }
  }
  window.scrollTo(0, y);
}

function maxY() {
  if (isMobileAppShell()) {
    const root = getAppScrollRoot();
    if (root) {
      return Math.max(0, root.scrollHeight - root.clientHeight);
    }
  }
  return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
}

let target = 0;
let current = 0;
let raf = 0;
let lastTs = 0;
let writing = false;
let smoothMs = PAGE_SCROLL_SMOOTH_MS;
let attached = false;
let retainCount = 0;

function onNativeScroll() {
  if (writing) {
    return;
  }
  const y = readY();
  // Our scrollTo fires this listener asynchronously after `writing` is already
  // false. Treat near-matches as echoes so we do not cancel the ease mid-flight.
  if (raf && Math.abs(y - current) < 6) {
    return;
  }
  current = y;
  target = y;
  if (raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
}

function attach() {
  if (attached || typeof window === "undefined") {
    return;
  }
  attached = true;
  window.addEventListener("scroll", onNativeScroll, { passive: true });
  getAppScrollRoot()?.addEventListener("scroll", onNativeScroll, { passive: true });
}

function detach() {
  if (!attached) {
    return;
  }
  attached = false;
  window.removeEventListener("scroll", onNativeScroll);
  getAppScrollRoot()?.removeEventListener("scroll", onNativeScroll);
  if (raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
}

export function retainSmoothPageScroll() {
  retainCount += 1;
  attach();
}

export function releaseSmoothPageScroll() {
  retainCount = Math.max(0, retainCount - 1);
  if (retainCount === 0) {
    detach();
  }
}

function step(now: number) {
  const dt = Math.min(now - lastTs, 32);
  lastTs = now;
  const k = 1 - Math.exp(-dt / smoothMs);
  current += (target - current) * k;
  writing = true;
  writeY(current);
  writing = false;
  if (Math.abs(target - current) > 0.4) {
    raf = requestAnimationFrame(step);
    return;
  }
  writing = true;
  writeY(target);
  writing = false;
  current = target;
  raf = 0;
}

export function wheelDeltaPixels(delta: number, deltaMode: number): number {
  if (deltaMode === 1) {
    return delta * 16;
  }
  if (deltaMode === 2) {
    return delta * (typeof window === "undefined" ? 800 : window.innerHeight || 800);
  }
  return delta;
}

export function isDiscreteWheel(event: WheelEvent): boolean {
  if (event.deltaMode !== 0) {
    return true;
  }
  return Math.abs(event.deltaY) >= 72 && Math.abs(event.deltaY) >= Math.abs(event.deltaX) * 2;
}

/**
 * Ease the page toward a new offset. Used when we `preventDefault` a wheel on
 * the marquee (native overflow would steal it). Discrete notches need a longer
 * constant so reversing past the flatten point does not jump.
 */
export function smoothScrollBy(deltaY: number, event?: WheelEvent) {
  if (typeof window === "undefined" || deltaY === 0) {
    return;
  }
  attach();
  const live = readY();
  if (raf === 0 || Math.abs(live - current) > 2) {
    current = live;
    target = live;
  }
  smoothMs = event && !isDiscreteWheel(event) ? PIXEL_SCROLL_SMOOTH_MS : PAGE_SCROLL_SMOOTH_MS;
  target = Math.max(0, Math.min(maxY(), target + deltaY));
  if (!raf) {
    lastTs = performance.now();
    raf = requestAnimationFrame(step);
  }
}
