import { ArrowRight, BarChart3, FileCheck2, LayoutTemplate, Lock, ShieldCheck, Sparkles, Target } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router";
import { Reveal } from "../components/motion/Reveal.tsx";
import { usePointerDepth } from "../lib/motion/motion.ts";

export function HomePage() {
  const stage = usePointerDepth<HTMLDivElement>();
  return (
    <div className="mx-auto max-w-[1400px] px-3 sm:px-6">
      {/* The whole hero listens to the pointer so the pages respond even when the cursor is on the text. */}
      <section ref={stage} className="grid items-center gap-10 py-12 sm:py-20 lg:grid-cols-[1.05fr_1fr] lg:gap-6 lg:py-24">
        <div className="max-w-2xl animate-page-in">
          <p className="inline-flex items-center gap-1.5 rounded-full border border-accent/15 bg-accent-soft px-3 py-1 text-xs font-semibold tracking-wide text-accent">
            <ShieldCheck className="size-3.5" aria-hidden /> Nothing is invented
          </p>
          <h1 className="mt-5 text-4xl font-semibold tracking-[-0.035em] text-balance sm:text-5xl lg:text-6xl lg:leading-[1.06]">
            Present your real experience at its best.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-ink-muted sm:text-lg">
            Build a clean, ATS-friendly resume and tailor it to any job description. Every suggestion is grounded in what you
            have actually done.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/resumes"
              className="group inline-flex h-11 items-center gap-2 rounded-xl bg-ink px-5 text-sm font-medium text-white shadow-raised transition-[transform,box-shadow] duration-300 ease-(--ease-out-soft) hover:-translate-y-0.5 hover:shadow-float"
            >
              Create a resume
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
            <Link
              to="/tailor"
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-surface/90 px-5 text-sm font-medium text-ink shadow-card transition-[transform,box-shadow,border-color] duration-300 ease-(--ease-out-soft) hover:-translate-y-0.5 hover:border-line-strong hover:shadow-raised"
            >
              <Target className="size-4 text-accent" aria-hidden />
              Tailor to a job
            </Link>
          </div>
          <ul className="mt-10 grid gap-3 border-t border-line pt-6 text-sm text-ink-muted sm:grid-cols-3">
            <TrustPoint icon={<Lock className="size-4" aria-hidden />}>Stays in your browser</TrustPoint>
            <TrustPoint icon={<FileCheck2 className="size-4" aria-hidden />}>ATS-friendly PDF &amp; DOCX</TrustPoint>
            <TrustPoint icon={<Sparkles className="size-4" aria-hidden />}>Truthful suggestions only</TrustPoint>
          </ul>
        </div>

        <HeroStack />
      </section>

      <section aria-labelledby="how-heading" className="pb-20 sm:pb-28">
        <h2 id="how-heading" className="sr-only">
          What you can do
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Reveal>
            <FeatureCard
              to="/resumes"
              icon={<LayoutTemplate className="size-5" aria-hidden />}
              title="Build"
              description="Guided sections, a live preview of the exact PDF, three ATS-friendly templates and DOCX export."
              cta="Open the builder"
            />
          </Reveal>
          <Reveal delay={90}>
            <FeatureCard
              to="/resumes"
              icon={<BarChart3 className="size-5" aria-hidden />}
              title="Analyse"
              description="A quality score and a parsing readiness score, every point explained, plus the text an ATS actually reads."
              cta="Check a resume"
            />
          </Reveal>
          <Reveal delay={180}>
            <FeatureCard
              to="/tailor"
              icon={<Target className="size-5" aria-hidden />}
              title="Tailor"
              description="Compare with a job description, see matching and missing keywords, and accept only truthful suggestions."
              cta="Start tailoring"
            />
          </Reveal>
        </div>
      </section>
    </div>
  );
}

function TrustPoint({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface text-accent shadow-card ring-1 ring-line">{icon}</span>
      {children}
    </li>
  );
}

function FeatureCard({ to, icon, title, description, cta }: { to: string; icon: ReactNode; title: string; description: string; cta: string }) {
  return (
    <Link
      to={to}
      className="group relative block h-full overflow-hidden rounded-card border border-line bg-surface/90 p-6 shadow-card transition-[transform,box-shadow] duration-300 ease-(--ease-out-soft) hover:-translate-y-1 hover:shadow-raised"
    >
      {/* Soft glow along the top edge on hover. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-6 -top-px h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      />
      <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent transition-transform duration-300 ease-(--ease-spring) group-hover:scale-110">
        {icon}
      </span>
      <h3 className="mt-5 text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{description}</p>
      <p className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-accent">
        {cta} <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" aria-hidden />
      </p>
    </Link>
  );
}

/**
 * Decorative illustration: a 3D stack of resume pages with floating score chips at different
 * depths. It tilts toward the cursor (parallax via --px / --py on the hero) and floats gently.
 * Hidden from assistive technology; the sample person is fictional and the numbers are examples.
 */
function HeroStack() {
  return (
    <div aria-hidden className="relative mx-auto h-[370px] w-full max-w-[520px] select-none sm:h-[460px] lg:h-[520px]">
      <div className="absolute inset-0 grid place-items-center">
        <div className="animate-float">
          <div className="tilt-3d relative h-[300px] w-[230px] sm:h-[400px] sm:w-[300px] lg:h-[440px] lg:w-[330px]">
            <Sheet className="translate-x-6 translate-y-5 [transform:translateZ(-80px)] opacity-60" />
            <Sheet className="translate-x-3 translate-y-2.5 [transform:translateZ(-40px)] opacity-80" />
            <Sheet main />
          </div>
        </div>
      </div>

      <Chip depth={26} className="-top-2 right-0 sm:top-[6%] sm:right-[4%]">
        <MiniRing value={94} />
        <span>
          <span className="block text-[13px] font-semibold text-ink">Resume Quality</span>
          <span className="block text-[11px] text-ink-muted">Every point explained</span>
        </span>
      </Chip>
      <Chip depth={-18} className="bottom-[18%] left-0 sm:left-[2%]">
        <span className="size-2 rounded-full bg-glow-violet" />
        <span>
          <span className="block text-[13px] font-semibold text-ink">Job match 82%</span>
          <span className="block text-[11px] text-ink-muted">Evidence for every keyword</span>
        </span>
      </Chip>
      <Chip depth={34} className="right-[6%] bottom-[4%]">
        <FileCheck2 className="size-4 text-success" />
        <span className="text-[13px] font-semibold text-ink">Parsing ready</span>
      </Chip>
    </div>
  );
}

function Chip({ depth, className, children }: { depth: number; className: string; children: ReactNode }) {
  return (
    <div className={`depth-layer absolute z-10 ${className}`} style={{ "--depth": depth } as CSSProperties}>
      <div className="glass-strong flex items-center gap-2.5 rounded-2xl border border-white/70 px-3.5 py-2.5 shadow-float">{children}</div>
    </div>
  );
}

function MiniRing({ value }: { value: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative grid size-10 place-items-center">
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
        <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3.5" className="stroke-subtle" />
        <circle cx="18" cy="18" r={r} fill="none" strokeWidth="3.5" strokeLinecap="round" className="stroke-accent" strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} />
      </svg>
      <span className="text-[11px] font-semibold tabular-nums">{value}</span>
    </span>
  );
}

/** A schematic resume page: real structure, placeholder lines instead of invented content. */
function Sheet({ main, className = "" }: { main?: boolean; className?: string }) {
  return (
    <div className={`absolute inset-0 rounded-[6px] bg-white shadow-float ring-1 ring-line ${className}`}>
      {main && (
        <div className="flex h-full flex-col gap-4 p-6 sm:p-7">
          <div>
            <p className="text-lg font-semibold tracking-tight text-ink sm:text-xl">Alex Morgan</p>
            <p className="text-[11px] text-ink-muted sm:text-xs">Product Designer · Lisbon</p>
          </div>
          <div className="h-px bg-line" />
          <SheetSection title="Experience" lines={[92, 78, 85]} />
          <SheetSection title="Projects" lines={[70, 88]} />
          <SheetSection title="Skills" chips />
          <SheetSection title="Education" lines={[60]} />
        </div>
      )}
    </div>
  );
}

function SheetSection({ title, lines = [], chips }: { title: string; lines?: number[]; chips?: boolean }) {
  return (
    <div>
      <p className="text-[9px] font-semibold tracking-[0.14em] text-ink-muted uppercase">{title}</p>
      {chips ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[38, 52, 30, 44].map((w) => (
            <span key={w} className="h-3.5 rounded bg-accent-soft" style={{ width: w }} />
          ))}
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-1.5">
          {lines.map((w, i) => (
            <span key={i} className="h-1.5 rounded-full bg-subtle" style={{ width: `${w}%` }} />
          ))}
        </div>
      )}
    </div>
  );
}
