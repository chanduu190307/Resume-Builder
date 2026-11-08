import { useEffect, useState } from "react";
import { getHealth } from "../lib/api.ts";

type Status = "checking" | "online" | "offline";

const LABEL: Record<Status, string> = {
  checking: "Connecting",
  online: "Engine online",
  offline: "Engine offline",
};

const DOT: Record<Status, string> = {
  checking: "bg-ink-faint",
  online: "bg-success",
  offline: "bg-danger",
};

/** Small indicator showing whether the analysis engine is reachable. */
export function EngineStatus() {
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    const controller = new AbortController();
    getHealth(controller.signal)
      .then(() => setStatus("online"))
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          console.warn("engine health check failed", err);
          setStatus("offline");
        }
      });
    return () => controller.abort();
  }, []);

  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/80 px-2.5 py-1 text-xs text-ink-muted"
      role="status"
      title={LABEL[status]}
    >
      <span className={`size-1.5 rounded-full ${DOT[status]} ${status === "online" ? "animate-pulse-dot" : ""}`} aria-hidden />
      <span className="sr-only sm:not-sr-only">{LABEL[status]}</span>
    </span>
  );
}
