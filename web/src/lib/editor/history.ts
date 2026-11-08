/**
 * Undo/redo around the resume reducer.
 *
 * Typing produces one action per keystroke; consecutive edits to the same field
 * (same `coalesceKey`) within COALESCE_MS are merged into one undo step.
 */
import { resumeReducer, type ResumeAction } from "./reducer.ts";
import type { Resume } from "../../types/resume.ts";

export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 1000;

export interface History {
  past: Resume[];
  present: Resume;
  future: Resume[];
  lastKey: string | null;
  lastAt: number;
}

export type HistoryAction =
  | { type: "edit"; action: ResumeAction; coalesceKey?: string; at?: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; resume: Resume };

export function initHistory(resume: Resume): History {
  return { past: [], present: resume, future: [], lastKey: null, lastAt: 0 };
}

export function historyReducer(state: History, action: HistoryAction): History {
  switch (action.type) {
    case "edit": {
      const next = resumeReducer(state.present, action.action);
      if (next === state.present) return state;
      const at = action.at ?? Date.now();
      const key = action.coalesceKey ?? null;
      const coalesce = key !== null && key === state.lastKey && at - state.lastAt < COALESCE_MS;
      return {
        past: coalesce ? state.past : [...state.past, state.present].slice(-HISTORY_LIMIT),
        present: next,
        future: [],
        lastKey: key,
        lastAt: at,
      };
    }
    case "undo": {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return {
        past: state.past.slice(0, -1),
        present: previous,
        future: [state.present, ...state.future],
        lastKey: null,
        lastAt: 0,
      };
    }
    case "redo": {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return { past: [...state.past, state.present], present: next, future: rest, lastKey: null, lastAt: 0 };
    }
    case "reset":
      return initHistory(action.resume);
  }
}
