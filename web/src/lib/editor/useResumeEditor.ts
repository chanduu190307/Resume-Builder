/**
 * Editor state for one resume: undo/redo history plus debounced autosave to
 * browser storage. Pending changes are flushed when the page is hidden or the
 * editor unmounts, so closing the tab right after typing does not lose work.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { getStore } from "../storage/db.ts";
import type { Resume } from "../../types/resume.ts";
import { historyReducer, initHistory } from "./history.ts";
import type { ResumeAction } from "./reducer.ts";

export type SaveStatus = "saved" | "pending" | "saving" | "error";

const AUTOSAVE_MS = 600;

export interface ResumeEditor {
  resume: Resume;
  edit: (action: ResumeAction, coalesceKey?: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  saveStatus: SaveStatus;
  flush: () => Promise<void>;
}

export function useResumeEditor(initial: Resume): ResumeEditor {
  const [history, dispatch] = useReducer(historyReducer, initial, initHistory);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");

  const latest = useRef(history.present);
  const lastSaved = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<void>>(Promise.resolve());

  const save = useCallback((): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    // Chain saves so they are written in order.
    saving.current = saving.current.then(async () => {
      const resume = latest.current;
      if (resume === lastSaved.current) return;
      setSaveStatus("saving");
      try {
        await getStore().save(resume);
        lastSaved.current = resume;
        setSaveStatus(latest.current === resume ? "saved" : "pending");
      } catch (err) {
        console.error("autosave failed", err);
        setSaveStatus("error");
      }
    });
    return saving.current;
  }, []);

  useEffect(() => {
    latest.current = history.present;
    if (history.present === lastSaved.current) return;
    setSaveStatus("pending");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), AUTOSAVE_MS);
  }, [history.present, save]);

  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void save();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onHide);
      void save();
    };
  }, [save]);

  // Warn before leaving while a save is outstanding or failed.
  useEffect(() => {
    if (saveStatus === "saved") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      void save();
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveStatus, save]);

  const edit = useCallback(
    (action: ResumeAction, coalesceKey?: string) => dispatch({ type: "edit", action, coalesceKey }),
    [],
  );
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);

  return {
    resume: history.present,
    edit,
    undo,
    redo,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    saveStatus,
    flush: save,
  };
}
