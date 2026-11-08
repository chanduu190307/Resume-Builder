import { createContext, useContext } from "react";
import type { ResumeAction } from "../../lib/editor/reducer.ts";

export type Edit = (action: ResumeAction, coalesceKey?: string) => void;

export const EditContext = createContext<Edit | null>(null);

/** Dispatches a resume edit. Pass a coalesceKey (e.g. "item:<id>:title") for text fields. */
export function useEdit(): Edit {
  const edit = useContext(EditContext);
  if (!edit) throw new Error("useEdit must be used inside an EditContext provider");
  return edit;
}
