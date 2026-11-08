/** Type-specific forms for one item. Labels describe what to enter; nothing is pre-filled. */
import type { ItemOf, PartialDate, SectionType } from "../../types/resume.ts";
import { Checkbox, Field, Select, TextArea, TextInput } from "../ui/fields.tsx";
import { MonthYearInput } from "../ui/MonthYearInput.tsx";
import { TagInput } from "../ui/TagInput.tsx";
import { BulletListEditor } from "./BulletListEditor.tsx";
import { useEdit } from "./EditorContext.tsx";

type Patch = Record<string, unknown>;

function useItemSetter(sectionId: string, itemId: string) {
  const edit = useEdit();
  return (field: string, value: unknown) =>
    edit({ type: "item/update", sectionId, itemId, patch: { [field]: value } as Patch }, `item:${itemId}:${field}`);
}

const nullIfBlank = (v: string) => (v === "" ? null : v);

interface DateRangeProps {
  start: PartialDate | null;
  end: PartialDate | null;
  current: boolean;
  currentLabel: string;
  set: (field: string, value: unknown) => void;
}

function DateRange({ start, end, current, currentLabel, set }: DateRangeProps) {
  return (
    <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
      <Field label="Start date">
        {(id) => <MonthYearInput id={id} label="Start" value={start} onValueChange={(v) => set("start", v)} />}
      </Field>
      <Field label="End date">
        {(id) => (
          <div className="flex flex-col gap-2">
            <MonthYearInput id={id} label="End" value={end} disabled={current} onValueChange={(v) => set("end", v)} />
            <Checkbox label={currentLabel} checked={current} onCheckedChange={(v) => set("current", v)} />
          </div>
        )}
      </Field>
    </div>
  );
}

const EMPLOYMENT_OPTIONS = [
  { value: "", label: "Not specified" },
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "internship", label: "Internship" },
  { value: "contract", label: "Contract" },
  { value: "freelance", label: "Freelance" },
  { value: "volunteer", label: "Volunteer" },
  { value: "other", label: "Other" },
] as const;

const SKILL_KIND_OPTIONS = [
  { value: "technical", label: "Technical" },
  { value: "tool", label: "Tools" },
  { value: "soft", label: "Soft skills" },
  { value: "domain", label: "Domain knowledge" },
  { value: "other", label: "Other" },
] as const;

interface ItemFieldsProps {
  type: SectionType;
  sectionId: string;
  item: ItemOf<SectionType>;
}

export function ItemFields({ type, sectionId, item }: ItemFieldsProps) {
  const set = useItemSetter(sectionId, item.id);
  const grid = "grid gap-3 sm:grid-cols-2";

  switch (type) {
    case "summary": {
      const it = item as ItemOf<"summary">;
      return (
        <div className="flex flex-col gap-3">
          <Field label="Type" className="sm:w-56">
            {(id) => (
              <Select
                id={id}
                value={it.kind}
                onValueChange={(v) => set("kind", v)}
                options={[
                  { value: "summary", label: "Professional summary" },
                  { value: "objective", label: "Career objective" },
                ]}
              />
            )}
          </Field>
          <Field label="Text">
            {(id) => <TextArea id={id} minRows={4} value={it.text} onValueChange={(v) => set("text", v)} />}
          </Field>
        </div>
      );
    }

    case "experience": {
      const it = item as ItemOf<"experience">;
      return (
        <div className="flex flex-col gap-4">
          <div className={grid}>
            <Field label="Job title">{(id) => <TextInput id={id} value={it.title} onValueChange={(v) => set("title", v)} />}</Field>
            <Field label="Company / organisation">
              {(id) => <TextInput id={id} value={it.organization} onValueChange={(v) => set("organization", v)} />}
            </Field>
            <Field label="Location">
              {(id) => <TextInput id={id} value={it.location} onValueChange={(v) => set("location", nullIfBlank(v))} />}
            </Field>
            <Field label="Employment type">
              {(id) => (
                <Select
                  id={id}
                  value={it.employment_type ?? ""}
                  onValueChange={(v) => set("employment_type", v === "" ? null : v)}
                  options={EMPLOYMENT_OPTIONS}
                />
              )}
            </Field>
            <DateRange start={it.start} end={it.end} current={it.current} currentLabel="I currently work here" set={set} />
          </div>
          <BulletListEditor sectionId={sectionId} itemId={it.id} bullets={it.bullets} label="What you did and achieved" />
          <Field label="Technologies used (optional)" hint="Press Enter or comma to add.">
            {(id) => <TagInput id={id} value={it.technologies} onValueChange={(v) => set("technologies", v)} />}
          </Field>
        </div>
      );
    }

    case "education": {
      const it = item as ItemOf<"education">;
      return (
        <div className="flex flex-col gap-4">
          <div className={grid}>
            <Field label="School / university" className="sm:col-span-2">
              {(id) => <TextInput id={id} value={it.institution} onValueChange={(v) => set("institution", v)} />}
            </Field>
            <Field label="Degree / qualification">
              {(id) => <TextInput id={id} value={it.degree} onValueChange={(v) => set("degree", nullIfBlank(v))} />}
            </Field>
            <Field label="Field of study">
              {(id) => <TextInput id={id} value={it.field_of_study} onValueChange={(v) => set("field_of_study", nullIfBlank(v))} />}
            </Field>
            <Field label="Location">
              {(id) => <TextInput id={id} value={it.location} onValueChange={(v) => set("location", nullIfBlank(v))} />}
            </Field>
            <Field label="Grade (optional)" hint="Written exactly as you enter it.">
              {(id) => <TextInput id={id} value={it.grade} onValueChange={(v) => set("grade", nullIfBlank(v))} />}
            </Field>
            <DateRange start={it.start} end={it.end} current={it.current} currentLabel="I currently study here" set={set} />
          </div>
          <BulletListEditor sectionId={sectionId} itemId={it.id} bullets={it.bullets} label="Coursework, honours or activities (optional)" />
        </div>
      );
    }

    case "projects": {
      const it = item as ItemOf<"projects">;
      return (
        <div className="flex flex-col gap-4">
          <div className={grid}>
            <Field label="Project name">{(id) => <TextInput id={id} value={it.name} onValueChange={(v) => set("name", v)} />}</Field>
            <Field label="Your role (optional)">
              {(id) => <TextInput id={id} value={it.role} onValueChange={(v) => set("role", nullIfBlank(v))} />}
            </Field>
            <Field label="For (company, course or club, optional)">
              {(id) => <TextInput id={id} value={it.organization} onValueChange={(v) => set("organization", nullIfBlank(v))} />}
            </Field>
            <Field label="Link (optional)">
              {(id) => <TextInput id={id} type="url" value={it.url} onValueChange={(v) => set("url", nullIfBlank(v))} />}
            </Field>
            <DateRange start={it.start} end={it.end} current={it.current} currentLabel="Ongoing" set={set} />
          </div>
          <BulletListEditor sectionId={sectionId} itemId={it.id} bullets={it.bullets} label="What you built and the outcome" />
          <Field label="Technologies used (optional)" hint="Press Enter or comma to add.">
            {(id) => <TagInput id={id} value={it.technologies} onValueChange={(v) => set("technologies", v)} />}
          </Field>
        </div>
      );
    }

    case "skills": {
      const it = item as ItemOf<"skills">;
      return (
        <div className="flex flex-col gap-3">
          <div className={grid}>
            <Field label="Group name (optional)" hint="e.g. Languages, Frameworks, Tools">
              {(id) => <TextInput id={id} value={it.name} onValueChange={(v) => set("name", nullIfBlank(v))} />}
            </Field>
            <Field label="Kind">
              {(id) => <Select id={id} value={it.kind} onValueChange={(v) => set("kind", v)} options={SKILL_KIND_OPTIONS} />}
            </Field>
          </div>
          <Field label="Skills" hint="Press Enter or comma to add. You can paste a comma-separated list.">
            {(id) => <TagInput id={id} value={it.skills} onValueChange={(v) => set("skills", v)} />}
          </Field>
        </div>
      );
    }

    case "certifications": {
      const it = item as ItemOf<"certifications">;
      return (
        <div className={grid}>
          <Field label="Certification name" className="sm:col-span-2">
            {(id) => <TextInput id={id} value={it.name} onValueChange={(v) => set("name", v)} />}
          </Field>
          <Field label="Issuer">{(id) => <TextInput id={id} value={it.issuer} onValueChange={(v) => set("issuer", nullIfBlank(v))} />}</Field>
          <Field label="Credential ID (optional)">
            {(id) => <TextInput id={id} value={it.credential_id} onValueChange={(v) => set("credential_id", nullIfBlank(v))} />}
          </Field>
          <Field label="Issued">{(id) => <MonthYearInput id={id} label="Issued" value={it.issued} onValueChange={(v) => set("issued", v)} />}</Field>
          <Field label="Expires (optional)">
            {(id) => <MonthYearInput id={id} label="Expires" value={it.expires} onValueChange={(v) => set("expires", v)} />}
          </Field>
          <Field label="Verification link (optional)" className="sm:col-span-2">
            {(id) => <TextInput id={id} type="url" value={it.url} onValueChange={(v) => set("url", nullIfBlank(v))} />}
          </Field>
        </div>
      );
    }

    case "publications": {
      const it = item as ItemOf<"publications">;
      return (
        <div className={grid}>
          <Field label="Title" className="sm:col-span-2">{(id) => <TextInput id={id} value={it.title} onValueChange={(v) => set("title", v)} />}</Field>
          <Field label="Authors" hint="In published order.">
            {(id) => <TextInput id={id} value={it.authors} onValueChange={(v) => set("authors", nullIfBlank(v))} />}
          </Field>
          <Field label="Journal / conference / publisher">
            {(id) => <TextInput id={id} value={it.publisher} onValueChange={(v) => set("publisher", nullIfBlank(v))} />}
          </Field>
          <Field label="Date">{(id) => <MonthYearInput id={id} label="Published" value={it.date} onValueChange={(v) => set("date", v)} />}</Field>
          <Field label="Link (optional)">
            {(id) => <TextInput id={id} type="url" value={it.url} onValueChange={(v) => set("url", nullIfBlank(v))} />}
          </Field>
          <Field label="Description (optional)" className="sm:col-span-2">
            {(id) => <TextArea id={id} value={it.description} onValueChange={(v) => set("description", nullIfBlank(v))} />}
          </Field>
        </div>
      );
    }

    case "languages": {
      const it = item as ItemOf<"languages">;
      return (
        <div className={grid}>
          <Field label="Language">{(id) => <TextInput id={id} value={it.language} onValueChange={(v) => set("language", v)} />}</Field>
          <Field label="Proficiency" hint="e.g. Native, Fluent, Professional, B2">
            {(id) => (
              <>
                <TextInput
                  id={id}
                  list="proficiency-options"
                  value={it.proficiency}
                  onValueChange={(v) => set("proficiency", nullIfBlank(v))}
                />
                <datalist id="proficiency-options">
                  {["Native", "Fluent", "Professional", "Intermediate", "Basic"].map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </>
            )}
          </Field>
        </div>
      );
    }

    case "awards": {
      const it = item as ItemOf<"awards">;
      return (
        <div className={grid}>
          <Field label="Award" className="sm:col-span-2">{(id) => <TextInput id={id} value={it.title} onValueChange={(v) => set("title", v)} />}</Field>
          <Field label="Awarded by">{(id) => <TextInput id={id} value={it.issuer} onValueChange={(v) => set("issuer", nullIfBlank(v))} />}</Field>
          <Field label="Date">{(id) => <MonthYearInput id={id} label="Awarded" value={it.date} onValueChange={(v) => set("date", v)} />}</Field>
          <Field label="Description (optional)" className="sm:col-span-2">
            {(id) => <TextArea id={id} value={it.description} onValueChange={(v) => set("description", nullIfBlank(v))} />}
          </Field>
        </div>
      );
    }

    case "custom": {
      const it = item as ItemOf<"custom">;
      return (
        <div className="flex flex-col gap-4">
          <div className={grid}>
            <Field label="Title">{(id) => <TextInput id={id} value={it.title} onValueChange={(v) => set("title", v)} />}</Field>
            <Field label="Subtitle (optional)">
              {(id) => <TextInput id={id} value={it.subtitle} onValueChange={(v) => set("subtitle", nullIfBlank(v))} />}
            </Field>
            <Field label="Date (optional)" hint="Free text, e.g. 2023 - 2025">
              {(id) => <TextInput id={id} value={it.date_text} onValueChange={(v) => set("date_text", nullIfBlank(v))} />}
            </Field>
            <Field label="Location (optional)">
              {(id) => <TextInput id={id} value={it.location} onValueChange={(v) => set("location", nullIfBlank(v))} />}
            </Field>
          </div>
          <BulletListEditor sectionId={sectionId} itemId={it.id} bullets={it.bullets} />
        </div>
      );
    }
  }
  return null;
}

/** One-line label for a collapsed item card. */
export function itemSummary(type: SectionType, item: ItemOf<SectionType>): string {
  const join = (...parts: (string | null | undefined)[]) => parts.map((p) => p?.trim()).filter(Boolean).join(" · ");
  switch (type) {
    case "summary": {
      const text = (item as ItemOf<"summary">).text.trim();
      return text.length > 80 ? `${text.slice(0, 80)}…` : text;
    }
    case "experience": {
      const it = item as ItemOf<"experience">;
      return join(it.title, it.organization);
    }
    case "education": {
      const it = item as ItemOf<"education">;
      return join(it.degree, it.institution);
    }
    case "projects":
      return (item as ItemOf<"projects">).name.trim();
    case "skills": {
      const it = item as ItemOf<"skills">;
      return join(it.name, it.skills.slice(0, 4).join(", ") + (it.skills.length > 4 ? "…" : ""));
    }
    case "certifications":
      return (item as ItemOf<"certifications">).name.trim();
    case "publications":
      return (item as ItemOf<"publications">).title.trim();
    case "languages": {
      const it = item as ItemOf<"languages">;
      return join(it.language, it.proficiency);
    }
    case "awards":
      return (item as ItemOf<"awards">).title.trim();
    case "custom": {
      const it = item as ItemOf<"custom">;
      return join(it.title, it.subtitle);
    }
  }
  return "";
}
