import { useEffect, useState } from "react";
import { MONTHS } from "../../lib/format/dates.ts";
import type { PartialDate } from "../../types/resume.ts";
import { controlClass } from "./fields.tsx";
import { cn } from "./cn.ts";

interface MonthYearInputProps {
  id?: string;
  value: PartialDate | null;
  onValueChange: (value: PartialDate | null) => void;
  disabled?: boolean;
  label: string;
}

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

/** Month (optional) + year. An empty year clears the date. */
export function MonthYearInput({ id, value, onValueChange, disabled, label }: MonthYearInputProps) {
  // Keep the typed year locally so partial input ("20") is not rejected while typing.
  const [yearText, setYearText] = useState(value ? String(value.year) : "");
  useEffect(() => setYearText(value ? String(value.year) : ""), [value]);

  const commitYear = (text: string) => {
    setYearText(text);
    if (text.trim() === "") return onValueChange(null);
    const year = Number(text);
    if (Number.isInteger(year) && year >= MIN_YEAR && year <= MAX_YEAR) {
      onValueChange({ year, month: value?.month ?? null });
    }
  };

  const yearInvalid = yearText !== "" && !(Number(yearText) >= MIN_YEAR && Number(yearText) <= MAX_YEAR);

  return (
    <div className="flex gap-2">
      <select
        aria-label={`${label} month`}
        className={cn(controlClass, "h-9 w-[5.5rem] shrink-0 cursor-pointer px-2")}
        value={value?.month ?? ""}
        disabled={disabled || !value}
        onChange={(e) => value && onValueChange({ ...value, month: e.target.value ? Number(e.target.value) : null })}
      >
        <option value="">Month</option>
        {MONTHS.map((m, i) => (
          <option key={m} value={i + 1}>
            {m}
          </option>
        ))}
      </select>
      <input
        id={id}
        aria-label={`${label} year`}
        aria-invalid={yearInvalid || undefined}
        inputMode="numeric"
        placeholder="Year"
        maxLength={4}
        disabled={disabled}
        className={cn(controlClass, "h-9 min-w-0 flex-1", yearInvalid && "border-danger focus:border-danger")}
        value={yearText}
        onChange={(e) => commitYear(e.target.value.replace(/\D/g, ""))}
      />
    </div>
  );
}
