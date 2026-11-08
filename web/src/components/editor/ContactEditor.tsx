import { Plus, Trash2 } from "lucide-react";
import type { Contact, Link } from "../../types/resume.ts";
import { Button, IconButton } from "../ui/Button.tsx";
import { Field, Select, TextInput } from "../ui/fields.tsx";
import { useEdit } from "./EditorContext.tsx";

const LINK_KINDS: readonly { value: Link["kind"]; label: string }[] = [
  { value: "linkedin", label: "LinkedIn" },
  { value: "github", label: "GitHub" },
  { value: "portfolio", label: "Portfolio" },
  { value: "website", label: "Website" },
  { value: "other", label: "Other" },
];

export function ContactEditor({ contact }: { contact: Contact }) {
  const edit = useEdit();
  const set = (field: keyof Omit<Contact, "links">, value: string, nullable = true) =>
    edit({ type: "contact/set", patch: { [field]: nullable && value === "" ? null : value } }, `contact:${field}`);

  return (
    <section aria-label="Contact details" data-field="contact" className="rounded-card border border-line bg-surface p-4 shadow-card">
      <h2 className="text-[15px] font-semibold tracking-tight">Contact details</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Full name">
          {(id) => <TextInput id={id} autoComplete="name" data-field="contact.full_name" value={contact.full_name} onValueChange={(v) => set("full_name", v, false)} />}
        </Field>
        <Field label="Professional title (optional)">
          {(id) => <TextInput id={id} data-field="contact.headline" value={contact.headline} onValueChange={(v) => set("headline", v)} />}
        </Field>
        <Field label="Email">
          {(id) => <TextInput id={id} type="email" autoComplete="email" data-field="contact.email" value={contact.email} onValueChange={(v) => set("email", v)} />}
        </Field>
        <Field label="Phone">
          {(id) => <TextInput id={id} type="tel" autoComplete="tel" data-field="contact.phone" value={contact.phone} onValueChange={(v) => set("phone", v)} />}
        </Field>
        <Field label="Location" hint="City and region/country is enough." className="sm:col-span-2">
          {(id) => <TextInput id={id} data-field="contact.location" value={contact.location} onValueChange={(v) => set("location", v)} />}
        </Field>
      </div>

      <div className="mt-4 flex flex-col gap-2 rounded-lg" data-field="contact.links">
        <span className="text-[13px] font-medium text-ink-muted">Links</span>
        {contact.links.map((link) => (
          <div key={link.id} className="flex items-center gap-2">
            <Select
              aria-label="Link type"
              className="w-32 shrink-0"
              value={link.kind}
              onValueChange={(kind) => edit({ type: "link/update", id: link.id, patch: { kind } })}
              options={LINK_KINDS}
            />
            <TextInput
              aria-label="Link URL"
              type="url"
              placeholder="linkedin.com/in/your-name"
              value={link.url}
              onValueChange={(url) => edit({ type: "link/update", id: link.id, patch: { url } }, `link:${link.id}`)}
            />
            <IconButton label="Remove link" tone="danger" onClick={() => edit({ type: "link/remove", id: link.id })}>
              <Trash2 className="size-4" aria-hidden />
            </IconButton>
          </div>
        ))}
        <div>
          <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" aria-hidden />} onClick={() => edit({ type: "link/add" })}>
            Add link
          </Button>
        </div>
      </div>
    </section>
  );
}
