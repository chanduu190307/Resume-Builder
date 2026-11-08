import { useRef, type CSSProperties, type ElementType, type ReactNode } from "react";
import { useInView } from "../../lib/motion/motion.ts";

interface RevealProps {
  children: ReactNode;
  /** Stagger in milliseconds. */
  delay?: number;
  as?: ElementType;
  className?: string;
}

/**
 * Fades and lifts its content in the first time it scrolls into view. Use sparingly, for
 * page-level blocks only (never form fields). Reduced motion shows content at once.
 */
export function Reveal({ children, delay = 0, as: Tag = "div", className }: RevealProps) {
  const ref = useRef<HTMLElement>(null);
  const shown = useInView(ref, 0.12);
  return (
    <Tag
      ref={ref}
      data-reveal={shown ? "shown" : "hidden"}
      className={className}
      style={delay ? ({ "--reveal-delay": `${delay}ms` } as CSSProperties) : undefined}
    >
      {children}
    </Tag>
  );
}
