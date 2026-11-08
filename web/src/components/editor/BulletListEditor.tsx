import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { newId } from "../../lib/ids.ts";
import type { Bullet } from "../../types/resume.ts";
import { Button, IconButton } from "../ui/Button.tsx";
import { TextArea } from "../ui/fields.tsx";
import { useEdit } from "./EditorContext.tsx";

/** Strips list markers people paste from old resumes: "• ", "- ", "* ", "1. ", "a) ". */
export function stripBulletMarker(line: string): string {
  return line.replace(/^\s*(?:[•●▪◦·*–-]|\d+[.)]|[a-z][.)])\s+/i, "").trim();
}

export function splitPastedLines(text: string): string[] {
  return text.split(/\r?\n/).map(stripBulletMarker).filter(Boolean);
}

interface Props {
  sectionId: string;
  itemId: string;
  bullets: Bullet[];
  label?: string;
  placeholder?: string;
}

export function BulletListEditor({ sectionId, itemId, bullets, label = "Bullet points", placeholder }: Props) {
  const edit = useEdit();
  const [focusId, setFocusId] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLTextAreaElement>());

  useEffect(() => {
    if (!focusId) return;
    const el = refs.current.get(focusId);
    if (el) {
      el.focus();
      setFocusId(null);
    }
  }, [focusId, bullets]);

  const base = { sectionId, itemId };

  const addAfter = (afterId?: string, text = "") => {
    const bulletId = newId();
    edit({ type: "bullet/add", ...base, afterId, text, bulletId });
    return bulletId;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>, bullet: Bullet, index: number) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      // Bullets are single paragraphs: Enter starts the next bullet.
      e.preventDefault();
      setFocusId(addAfter(bullet.id));
    } else if (e.key === "Backspace" && bullet.text === "" && bullets.length > 1) {
      e.preventDefault();
      const previous = bullets[index - 1] ?? bullets[index + 1];
      edit({ type: "bullet/remove", ...base, bulletId: bullet.id });
      if (previous) setFocusId(previous.id);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>, bullet: Bullet) => {
    const lines = splitPastedLines(e.clipboardData.getData("text"));
    if (lines.length < 2) return;
    e.preventDefault();
    const el = e.currentTarget;
    const before = bullet.text.slice(0, el.selectionStart);
    const after = bullet.text.slice(el.selectionEnd);
    edit({ type: "bullet/update", ...base, bulletId: bullet.id, text: before + lines[0] });
    let previousId = bullet.id;
    lines.slice(1).forEach((line, i) => {
      const isLast = i === lines.length - 2;
      previousId = addAfter(previousId, isLast ? line + after : line);
    });
    setFocusId(previousId);
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-medium text-ink-muted">{label}</span>
      {bullets.map((bullet, index) => (
        <div key={bullet.id} className="group flex items-start gap-1.5">
          <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-ink-faint" aria-hidden />
          <TextArea
            ref={(el) => {
              if (el) refs.current.set(bullet.id, el);
              else refs.current.delete(bullet.id);
            }}
            aria-label={`${label} ${index + 1}`}
            data-bullet-id={bullet.id}
            minRows={1}
            value={bullet.text}
            placeholder={index === 0 ? placeholder : undefined}
            onValueChange={(text) =>
              edit({ type: "bullet/update", ...base, bulletId: bullet.id, text }, `bullet:${bullet.id}`)
            }
            onKeyDown={(e) => onKeyDown(e, bullet, index)}
            onPaste={(e) => onPaste(e, bullet)}
          />
          <div className="flex shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
            <IconButton
              label="Move bullet up"
              disabled={index === 0}
              onClick={() => edit({ type: "bullet/move", ...base, bulletId: bullet.id, dir: -1 })}
            >
              <ArrowUp className="size-3.5" aria-hidden />
            </IconButton>
            <IconButton
              label="Move bullet down"
              disabled={index === bullets.length - 1}
              onClick={() => edit({ type: "bullet/move", ...base, bulletId: bullet.id, dir: 1 })}
            >
              <ArrowDown className="size-3.5" aria-hidden />
            </IconButton>
            <IconButton
              label="Delete bullet"
              tone="danger"
              onClick={() => edit({ type: "bullet/remove", ...base, bulletId: bullet.id })}
            >
              <Trash2 className="size-3.5" aria-hidden />
            </IconButton>
          </div>
        </div>
      ))}
      <div>
        <Button
          size="sm"
          variant="ghost"
          icon={<Plus className="size-3.5" aria-hidden />}
          onClick={() => setFocusId(addAfter(bullets[bullets.length - 1]?.id))}
        >
          Add bullet
        </Button>
      </div>
    </div>
  );
}
