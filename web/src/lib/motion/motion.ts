/**
 * The motion layer (Phase 7). Every effect in the app goes through these helpers so that
 * motion is consistent and can be switched off in one place:
 * - prefers-reduced-motion: every helper becomes a no-op and final values are shown at once
 * - touch / coarse pointers: pointer depth (parallax, tilt) is disabled
 * - no IntersectionObserver (old browsers, tests): content is shown immediately
 * Nothing here ever hides content permanently or delays an interaction.
 */
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";
const FINE_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

function media(query: string): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
}

export function prefersReducedMotion(): boolean {
  return media(REDUCED_QUERY)?.matches ?? false;
}

export function hasFinePointer(): boolean {
  return media(FINE_POINTER_QUERY)?.matches ?? false;
}

function subscribeReduced(onChange: () => void): () => void {
  const mql = media(REDUCED_QUERY);
  mql?.addEventListener?.("change", onChange);
  return () => mql?.removeEventListener?.("change", onChange);
}

/** Live value of the user's reduced-motion preference. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, prefersReducedMotion, () => false);
}

/**
 * Sets --px / --py (each in [-1, 1], 0 = centre) on the element while the pointer moves over
 * it (or over `scope`, defaulting to the element). CSS classes `.depth-layer` and `.tilt-3d`
 * turn those variables into parallax and 3D tilt. Disabled for reduced motion and touch.
 */
export function usePointerDepth<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion() || !hasFinePointer()) return;
    let frame = 0;
    let next: [number, number] = [0, 0];
    const apply = () => {
      frame = 0;
      el.style.setProperty("--px", next[0].toFixed(3));
      el.style.setProperty("--py", next[1].toFixed(3));
    };
    const schedule = (x: number, y: number) => {
      next = [x, y];
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const clamp = (v: number) => Math.max(-1, Math.min(1, v));
      schedule(clamp(((e.clientX - r.left) / r.width) * 2 - 1), clamp(((e.clientY - r.top) / r.height) * 2 - 1));
    };
    const onLeave = () => schedule(0, 0);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return ref;
}

/**
 * True once the element has scrolled into view (and stays true). Without
 * IntersectionObserver, or with reduced motion, it is true immediately.
 */
export function useInView<T extends Element>(ref: RefObject<T | null>, threshold = 0.2): boolean {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === "undefined" || prefersReducedMotion());
  useEffect(() => {
    const el = ref.current;
    if (seen || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen, threshold]);
  return seen;
}

/** easeOutCubic: fast start, gentle landing. Exported for tests. */
export function easeOut(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return 1 - (1 - c) ** 3;
}

/**
 * Animates a number from its previous value to `target` while `active`. Returns the value to
 * display. Reduced motion (or a non-animating environment) returns `target` directly.
 * Decorative only: callers must also expose the real value to assistive technology.
 */
export function useCountUp(target: number, active: boolean, durationMs = 900): number {
  const reduced = useReducedMotion();
  const canAnimate = typeof requestAnimationFrame !== "undefined";
  const [value, setValue] = useState(active && !reduced && canAnimate ? 0 : target);
  const fromRef = useRef(value);

  useEffect(() => {
    if (!active) return;
    if (reduced || !canAnimate) {
      fromRef.current = target;
      setValue(target);
      return;
    }
    const from = fromRef.current;
    if (from === target) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / durationMs;
      const v = t >= 1 ? target : Math.round(from + (target - from) * easeOut(t));
      fromRef.current = v;
      setValue(v);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, active, reduced, durationMs, canAnimate]);

  return value;
}
