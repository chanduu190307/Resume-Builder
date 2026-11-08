import { useRef } from "react";
import { useCountUp, useInView } from "../../lib/motion/motion.ts";
import { cn } from "../ui/cn.ts";

export type Tone = "success" | "warning" | "danger" | "accent";

export function toneFor(value: number, max = 100): Tone {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return pct >= 70 ? "success" : pct >= 50 ? "warning" : "danger";
}

const STROKE: Record<Tone, string> = {
  success: "stroke-success",
  warning: "stroke-warning",
  danger: "stroke-danger",
  accent: "stroke-accent",
};
const FILL: Record<Tone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  accent: "bg-accent",
};

interface RingProps {
  value: number;
  max?: number;
  size?: number;
  stroke?: number;
  tone?: Tone;
  /** Shown under the number inside the ring, e.g. "/ 100". */
  caption?: string;
  className?: string;
}

/**
 * Circular score gauge. The ring fills and the number counts up the first time it scrolls into
 * view. The real value is always available to screen readers via the visually hidden text.
 */
export function ScoreRing({ value, max = 100, size = 88, stroke = 8, tone, caption, className }: RingProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, 0.3);
  const shown = useCountUp(value, inView);
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const fraction = max > 0 ? Math.max(0, Math.min(1, (inView ? value : 0) / max)) : 0;
  const t = tone ?? toneFor(value, max);

  return (
    <div ref={ref} className={cn("relative inline-grid shrink-0 place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-subtle" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          className={cn(STROKE[t], "transition-[stroke-dashoffset] duration-[1100ms] ease-(--ease-out-soft)")}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
        />
      </svg>
      <span className="absolute inset-0 grid place-content-center text-center leading-none" aria-hidden>
        <span className="font-semibold tracking-tight tabular-nums" style={{ fontSize: size * 0.28 }}>
          {shown}
        </span>
        {caption && <span className="mt-1 text-[11px] text-ink-faint">{caption}</span>}
      </span>
      <span className="sr-only">
        {value} out of {max}
      </span>
    </div>
  );
}

interface MeterProps {
  value: number;
  max: number;
  tone?: Tone;
  className?: string;
  /** Delay in ms, for staggering a list of bars. */
  delay?: number;
}

/** Horizontal bar that fills when scrolled into view. Decorative: show the numbers as text too. */
export function MeterBar({ value, max, tone, className, delay = 0 }: MeterProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, 0.2);
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div ref={ref} className={cn("h-1.5 overflow-hidden rounded-full bg-subtle", className)} aria-hidden>
      <div
        className={cn("h-full rounded-full transition-[width] duration-[900ms] ease-(--ease-out-soft)", FILL[tone ?? toneFor(value, max)])}
        style={{ width: `${inView ? pct : 0}%`, transitionDelay: `${delay}ms` }}
      />
    </div>
  );
}
