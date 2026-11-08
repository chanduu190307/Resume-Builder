/** Form controls. Every control has a visible label tied to it with htmlFor/id. */
import {
  forwardRef,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "./cn.ts";

export const controlClass =
  "w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-faint transition-colors hover:border-line-strong focus:border-accent focus:outline-none focus:ring-3 focus:ring-accent/15";

interface FieldProps {
  label: string;
  hint?: ReactNode;
  className?: string;
  children: (id: string) => ReactNode;
}

export function Field({ label, hint, className, children }: FieldProps) {
  const id = useId();
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink-muted">
        {label}
      </label>
      {children(id)}
      {hint ? <p className="text-xs text-ink-faint">{hint}</p> : null}
    </div>
  );
}

type TextInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & {
  value: string | null | undefined;
  onValueChange: (value: string) => void;
};

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { value, onValueChange, className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(controlClass, "h-9", className)}
      value={value ?? ""}
      onChange={(e) => onValueChange(e.target.value)}
      {...props}
    />
  );
});

type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string | null | undefined;
  onValueChange: (value: string) => void;
  minRows?: number;
};

/** Textarea that grows with its content. */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { value, onValueChange, className, minRows = 2, ...props },
  forwardedRef,
) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);

  return (
    <textarea
      ref={(el) => {
        innerRef.current = el;
        if (typeof forwardedRef === "function") forwardedRef(el);
        else if (forwardedRef) forwardedRef.current = el;
      }}
      rows={minRows}
      className={cn(controlClass, "resize-none py-2 leading-relaxed", className)}
      value={value ?? ""}
      onChange={(e) => onValueChange(e.target.value)}
      {...props}
    />
  );
});

type SelectProps<T extends string> = Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange"> & {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
};

export function Select<T extends string>({ value, onValueChange, options, className, ...props }: SelectProps<T>) {
  return (
    <select
      className={cn(controlClass, "h-9 cursor-pointer pr-8", className)}
      value={value}
      onChange={(e) => onValueChange(e.target.value as T)}
      {...props}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Checkbox({
  checked,
  onCheckedChange,
  label,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onCheckedChange(e.target.checked)}
        className="size-4 cursor-pointer rounded border-line-strong accent-accent"
      />
      <label htmlFor={id} className="cursor-pointer text-[13px] text-ink-muted select-none">
        {label}
      </label>
    </div>
  );
}

/** Focuses an element once when `when` becomes true. */
export function useAutoFocus<T extends HTMLElement>(when: boolean) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    if (when) ref.current?.focus();
  }, [when]);
  return ref;
}
