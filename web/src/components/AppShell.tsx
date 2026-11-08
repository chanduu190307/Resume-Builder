import { FileText, Lock } from "lucide-react";
import { ViewTransition } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { EngineStatus } from "./EngineStatus.tsx";

/** Top-level route segment, so moving between pages animates but edits inside a page never do. */
function pageKey(pathname: string): string {
  return pathname.split("/").slice(0, 3).join("/") || "/";
}

export function AppShell() {
  const { pathname } = useLocation();
  return (
    <div className="relative isolate flex min-h-dvh flex-col">
      <Atmosphere />
      <header className="glass sticky top-0 z-20 border-b border-line/70">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between px-3 sm:px-6">
          <Link to="/" aria-label="Resume Builder home" className="group flex shrink-0 items-center gap-2 text-[15px] font-semibold tracking-tight">
            <span className="grid size-7 place-items-center rounded-lg bg-ink text-white shadow-card transition-transform duration-300 ease-(--ease-spring) group-hover:-rotate-6 group-hover:scale-105">
              <FileText className="size-4" strokeWidth={2} aria-hidden />
            </span>
            <span className="hidden sm:inline">Resume Builder</span>
          </Link>
          <nav aria-label="Main" className="mr-auto ml-3 flex items-center gap-1 sm:ml-6">
            {[
              ["/resumes", "Resumes"],
              ["/jobs", "Applications"],
            ].map(([to, label]) => (
              <NavLink
                key={to}
                to={to!}
                className={({ isActive }) =>
                  `relative rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                    isActive ? "bg-accent-soft text-accent" : "text-ink-muted hover:bg-subtle hover:text-ink"
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>
          <EngineStatus />
        </div>
      </header>

      <main className="flex-1">
        <ViewTransition key={pageKey(pathname)} default="none" enter="page-enter" exit="page-exit">
          <div>
            <Outlet />
          </div>
        </ViewTransition>
      </main>

      <footer className="border-t border-line/70 bg-canvas/60">
        <div className="mx-auto flex max-w-[1400px] items-center gap-2 px-3 py-5 text-xs text-ink-muted sm:px-6">
          <Lock className="size-3.5 shrink-0" aria-hidden />
          No account needed. Your resumes are stored only in this browser.
          <Link to="/privacy" className="ml-auto text-ink-muted underline-offset-2 hover:text-ink hover:underline">
            Privacy
          </Link>
        </div>
      </footer>
    </div>
  );
}

/**
 * Soft indigo / violet / sky glows behind every page, for depth. Purely decorative, fixed,
 * never interactive, and they stop drifting under reduced motion.
 */
function Atmosphere() {
  // Radial gradients instead of blur() filters: same soft look, but cheap to move, so the
  // drift costs almost nothing even on large screens and machines without a GPU.
  const glow = (rgb: string, alpha: number) => ({
    background: `radial-gradient(closest-side, rgb(${rgb} / ${alpha}), rgb(${rgb} / 0))`,
  });
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="animate-drift absolute -top-64 -left-56 size-[56rem]" style={glow("79 70 229", 0.09)} />
      <div className="animate-drift absolute top-[15%] -right-64 size-[52rem]" style={{ ...glow("139 92 246", 0.08), animationDelay: "-8s" }} />
      <div className="animate-drift absolute -bottom-72 left-1/4 size-[50rem]" style={{ ...glow("14 165 233", 0.07), animationDelay: "-15s" }} />
    </div>
  );
}
