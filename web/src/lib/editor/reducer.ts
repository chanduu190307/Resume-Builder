/**
 * Pure resume reducer: every edit in the builder is one of these actions.
 * Never mutates its input. Unknown ids are ignored (no-op) rather than throwing,
 * so a stale UI event can never corrupt or drop data.
 */
import { createBullet, createItem, createLink, createSection } from "../factories.ts";
import type {
  Bullet,
  Contact,
  ItemOf,
  Link,
  Resume,
  ResumeMeta,
  Section,
  SectionOf,
  SectionType,
} from "../../types/resume.ts";

export type Direction = -1 | 1;

/** Fields an item patch may change: everything except identity and bullets. */
export type ItemPatch = Record<string, unknown>;

export type ResumeAction =
  | { type: "meta/set"; patch: Partial<ResumeMeta> }
  | { type: "contact/set"; patch: Partial<Omit<Contact, "links">> }
  | { type: "link/add" }
  | { type: "link/update"; id: string; patch: Partial<Omit<Link, "id">> }
  | { type: "link/remove"; id: string }
  | { type: "section/add"; sectionType: SectionType; title?: string }
  | { type: "section/update"; id: string; patch: { title?: string; visible?: boolean } }
  | { type: "section/remove"; id: string }
  | { type: "section/move"; id: string; dir: Direction }
  | { type: "item/add"; sectionId: string }
  | { type: "item/update"; sectionId: string; itemId: string; patch: ItemPatch }
  | { type: "item/remove"; sectionId: string; itemId: string }
  | { type: "item/move"; sectionId: string; itemId: string; dir: Direction }
  | { type: "bullet/add"; sectionId: string; itemId: string; afterId?: string; text?: string; bulletId?: string }
  | { type: "bullet/update"; sectionId: string; itemId: string; bulletId: string; text: string; origin?: Bullet["origin"] }
  | { type: "bullet/remove"; sectionId: string; itemId: string; bulletId: string }
  | { type: "bullet/move"; sectionId: string; itemId: string; bulletId: string; dir: Direction }
  /** Set the bullet order; ignored unless `order` contains exactly the item's bullet ids. */
  | { type: "bullet/reorder"; sectionId: string; itemId: string; order: string[] }
  /** Add a skill to a group (skipping duplicates), or create a Skills section if none is given. */
  | { type: "skills/add"; sectionId: string | null; itemId: string | null; skill: string }
  | { type: "resume/replace"; resume: Resume };

const PROTECTED_ITEM_KEYS = new Set(["id", "bullets"]);

export function move<T>(list: readonly T[], index: number, dir: Direction): T[] {
  const target = index + dir;
  if (index < 0 || target < 0 || target >= list.length) return list as T[];
  const next = list.slice();
  [next[index], next[target]] = [next[target] as T, next[index] as T];
  return next;
}

/** Returns the original array when nothing was removed, so no-op actions stay no-ops. */
function without<T extends { id: string }>(list: T[], id: string): T[] {
  const next = list.filter((x) => x.id !== id);
  return next.length === list.length ? list : next;
}

function withSections(resume: Resume, sections: Section[]): Resume {
  return sections === resume.sections ? resume : { ...resume, sections };
}

function mapSection(resume: Resume, id: string, fn: (s: Section) => Section): Resume {
  let changed = false;
  const sections = resume.sections.map((s) => {
    if (s.id !== id) return s;
    const next = fn(s);
    if (next !== s) changed = true;
    return next;
  });
  return changed ? { ...resume, sections } : resume;
}

type AnyItem = Section["items"][number];

function mapItems(section: Section, fn: (items: AnyItem[]) => AnyItem[]): Section {
  const items = fn(section.items as AnyItem[]);
  return items === section.items ? section : ({ ...section, items } as Section);
}

function mapItem(section: Section, itemId: string, fn: (item: AnyItem) => AnyItem): Section {
  return mapItems(section, (items) => {
    let changed = false;
    const next = items.map((it) => {
      if (it.id !== itemId) return it;
      const updated = fn(it);
      if (updated !== it) changed = true;
      return updated;
    });
    return changed ? next : items;
  });
}

function mapBullets(item: AnyItem, fn: (bullets: Bullet[]) => Bullet[]): AnyItem {
  if (!("bullets" in item)) return item;
  const bullets = fn(item.bullets);
  return bullets === item.bullets ? item : { ...item, bullets };
}

function sanitizeItemPatch(patch: ItemPatch): ItemPatch {
  return Object.fromEntries(Object.entries(patch).filter(([key]) => !PROTECTED_ITEM_KEYS.has(key)));
}

/** Enforces the schema rule "a current item cannot have an end date". */
function applyItemPatch(item: AnyItem, patch: ItemPatch): AnyItem {
  const next = { ...item, ...sanitizeItemPatch(patch) } as AnyItem;
  if ("current" in next && next.current && "end" in next && next.end !== null) {
    return { ...next, end: null } as AnyItem;
  }
  return next;
}

export function resumeReducer(resume: Resume, action: ResumeAction): Resume {
  switch (action.type) {
    case "meta/set":
      return { ...resume, meta: { ...resume.meta, ...action.patch } };

    case "contact/set":
      return { ...resume, contact: { ...resume.contact, ...action.patch } };

    case "link/add":
      return { ...resume, contact: { ...resume.contact, links: [...resume.contact.links, createLink()] } };

    case "link/update":
      return {
        ...resume,
        contact: {
          ...resume.contact,
          links: resume.contact.links.map((l) => (l.id === action.id ? { ...l, ...action.patch } : l)),
        },
      };

    case "link/remove": {
      const links = without(resume.contact.links, action.id);
      return links === resume.contact.links ? resume : { ...resume, contact: { ...resume.contact, links } };
    }

    case "section/add":
      return { ...resume, sections: [...resume.sections, createSection(action.sectionType, action.title) as Section] };

    case "section/update":
      return mapSection(resume, action.id, (s) => ({ ...s, ...action.patch }) as Section);

    case "section/remove":
      return withSections(resume, without(resume.sections, action.id));

    case "section/move": {
      const index = resume.sections.findIndex((s) => s.id === action.id);
      return withSections(resume, move(resume.sections, index, action.dir));
    }

    case "item/add":
      return mapSection(resume, action.sectionId, (s) =>
        mapItems(s, (items) => [...items, createItem(s.type) as AnyItem]),
      );

    case "item/update":
      return mapSection(resume, action.sectionId, (s) =>
        mapItem(s, action.itemId, (it) => applyItemPatch(it, action.patch)),
      );

    case "item/remove":
      return mapSection(resume, action.sectionId, (s) =>
        mapItems(s, (items) => without(items, action.itemId)),
      );

    case "item/move":
      return mapSection(resume, action.sectionId, (s) =>
        mapItems(s, (items) => move(items, items.findIndex((it) => it.id === action.itemId), action.dir)),
      );

    case "bullet/add":
      return mapSection(resume, action.sectionId, (s) =>
        mapItem(s, action.itemId, (it) =>
          mapBullets(it, (bullets) => {
            const at = action.afterId ? bullets.findIndex((b) => b.id === action.afterId) + 1 : bullets.length;
            const next = bullets.slice();
            // A caller-supplied id lets the UI focus the new bullet; never allow a duplicate.
            const idFree = action.bulletId && !bullets.some((b) => b.id === action.bulletId);
            const bullet = { ...createBullet(action.text ?? ""), ...(idFree ? { id: action.bulletId } : {}) };
            next.splice(at <= 0 ? bullets.length : at, 0, bullet);
            return next;
          }),
        ),
      );

    case "bullet/update":
      return mapSection(resume, action.sectionId, (s) =>
        mapItem(s, action.itemId, (it) =>
          mapBullets(it, (bullets) =>
            bullets.map((b) =>
              b.id === action.bulletId ? { ...b, text: action.text, ...(action.origin ? { origin: action.origin } : {}) } : b,
            ),
          ),
        ),
      );

    case "bullet/reorder":
      return mapSection(resume, action.sectionId, (s) =>
        mapItem(s, action.itemId, (it) =>
          mapBullets(it, (bullets) => {
            const byId = new Map(bullets.map((b) => [b.id, b]));
            const sameSet = action.order.length === bullets.length && action.order.every((id) => byId.has(id));
            if (!sameSet || action.order.every((id, i) => bullets[i]?.id === id)) return bullets;
            return action.order.map((id) => byId.get(id)!);
          }),
        ),
      );

    case "skills/add": {
      const skill = action.skill.trim();
      if (!skill) return resume;
      const has = (list: string[]) => list.some((s) => s.toLowerCase() === skill.toLowerCase());
      if (action.sectionId && action.itemId) {
        return mapSection(resume, action.sectionId, (s) =>
          s.type !== "skills"
            ? s
            : mapItem(s, action.itemId!, (it) => {
                const group = it as ItemOf<"skills">;
                return has(group.skills) ? it : ({ ...group, skills: [...group.skills, skill] } as typeof it);
              }),
        );
      }
      const section = createSection("skills") as SectionOf<"skills">;
      section.items[0] = { ...section.items[0]!, skills: [skill] };
      return { ...resume, sections: [...resume.sections, section as Section] };
    }

    case "bullet/remove":
      return mapSection(resume, action.sectionId, (s) =>
        mapItem(s, action.itemId, (it) => mapBullets(it, (bullets) => without(bullets, action.bulletId))),
      );

    case "bullet/move":
      return mapSection(resume, action.sectionId, (s) =>
        mapItem(s, action.itemId, (it) =>
          mapBullets(it, (bullets) => move(bullets, bullets.findIndex((b) => b.id === action.bulletId), action.dir)),
        ),
      );

    case "resume/replace":
      return action.resume;
  }
}
