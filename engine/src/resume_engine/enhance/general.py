"""General improvement suggestions, without a job description.

Deterministic fixes only ever remove or re-inflect words that are already
there (drop "I", put a past role's first verb in the past tense, remove an
exact duplicate). Anything that needs new wording is either a prompt for the
user (add a real number, rewrite a duty-style bullet) or an AI proposal that
must pass the truthfulness guard.
"""

from __future__ import annotations

import re

from ..analysis import text as T
from ..analysis.models import Ref
from ..analysis.view import visible_sections
from ..jobs.tailor import EditOp, Suggestion, _metric_question, _sid
from ..schema import Resume


def _past_tense_first_word(text: str) -> str | None:
    """'Build APIs' -> 'Built APIs', 'Manages budgets' -> 'Managed budgets'. None if not applicable."""
    m = re.match(r"([A-Za-z][A-Za-z'-]*)(.*)", text.strip(), re.DOTALL)
    if not m:
        return None
    word, rest = m.group(1), m.group(2)
    lower = word.lower()
    if lower in T.BASE_VERBS:
        base: str | None = lower
    else:  # third person: "Manages" -> "manage"
        base = next((b for b in T.BASE_VERBS if lower in (b + "s", b + "es")), None)
    if base is None:
        return None
    past = T._past(base)
    past = past[:1].upper() + past[1:] if word[:1].isupper() else past
    return past + rest


def _without_first_person(text: str) -> str | None:
    """'I led the team' -> 'Led the team'. Only a leading 'I'/'I've'; other pronouns need a human."""
    m = re.match(r"\s*I(?:'ve| have)?\s+(\w)(.*)", text, re.DOTALL)
    if not m:
        return None
    return m.group(1).upper() + m.group(2)


def suggest_general(resume: Resume) -> list[Suggestion]:
    out: list[Suggestion] = []
    sections = visible_sections(resume)

    seen_bullets: dict[str, str] = {}
    metric_candidates = []
    for s in sections:
        if s.type not in ("experience", "projects", "custom", "education"):
            continue
        for item in s.items:
            for b in item.bullets:
                text = b.text.strip()
                if not text:
                    continue
                ref = Ref(section_id=s.id, item_id=item.id, bullet_id=b.id)
                base_op = dict(section_id=s.id, item_id=item.id, bullet_id=b.id, old=b.text)

                # Exact (case/space-insensitive) duplicates: offer to remove the repeat.
                key = re.sub(r"\W+", " ", text.lower()).strip()
                if key in seen_bullets:
                    out.append(Suggestion(
                        id=_sid("dup", b.id), kind="remove_duplicate", priority=1, title="Remove a repeated bullet",
                        reason="This bullet repeats another one word for word.", before=text, ref=ref,
                        ops=[EditOp(op="remove_bullet", **base_op)],
                    ))
                    continue
                seen_bullets[key] = b.id

                fixed = _without_first_person(text)
                if fixed:
                    out.append(Suggestion(
                        id=_sid("first_person", b.id, text), kind="remove_first_person", priority=1,
                        title="Drop “I” from this bullet",
                        reason="Resume bullets usually start with the verb. Only the pronoun is removed.",
                        before=text, after=fixed, ref=ref,
                        ops=[EditOp(op="set_bullet_text", new=fixed, **base_op)],
                    ))
                    text = fixed

                if s.type == "experience" and not getattr(item, "current", False) and T.verb_tense(text) == "present":
                    past = _past_tense_first_word(text)
                    if past and past != text:
                        out.append(Suggestion(
                            id=_sid("tense", b.id, text), kind="fix_tense", priority=1,
                            title="Use past tense for a role you have left",
                            reason="Earlier roles read best in the past tense. Only the first verb changes.",
                            before=b.text, after=past, ref=ref,
                            ops=[EditOp(op="set_bullet_text", new=past, **base_op)],
                        ))

                weak = T.weak_phrases(text)
                if weak:
                    out.append(Suggestion(
                        id=_sid("weak", b.id, text), kind="rewrite_weak", priority=2,
                        title=f"Rewrite “{weak[0]}” as what you did",
                        reason="Duty-style phrases describe a job, not your contribution. Start with a verb and say what changed because of you.",
                        before=b.text, editable=True, ref=ref,
                        ops=[EditOp(op="set_bullet_text", **base_op)],
                    ))

                if s.type in ("experience", "projects") and not T.is_quantified(text):
                    metric_candidates.append((s, item, b))

    for s, item, b in metric_candidates[:6]:  # earliest-listed (usually most recent) roles first
        out.append(Suggestion(
            id=_sid("metric", b.id, b.text), kind="add_metric", priority=2, title="Add a real number to this point",
            reason=_metric_question(b.text) + " Only use a figure you could explain in an interview.",
            before=b.text, editable=True, ref=Ref(section_id=s.id, item_id=item.id, bullet_id=b.id),
            ops=[EditOp(op="set_bullet_text", section_id=s.id, item_id=item.id, bullet_id=b.id, old=b.text)],
        ))

    # Duplicate skills: keep the first occurrence within each group.
    for s in sections:
        if s.type != "skills":
            continue
        for g in s.items:
            seen: set[str] = set()
            deduped = [sk for sk in g.skills if not (sk.lower().strip() in seen or seen.add(sk.lower().strip()))]
            if len(deduped) < len(g.skills):
                out.append(Suggestion(
                    id=_sid("dup_skills", g.id, *g.skills), kind="dedupe_skills", priority=1,
                    title="Remove repeated skills", reason="Some skills are listed twice in this group.",
                    before=", ".join(g.skills), after=", ".join(deduped), ref=Ref(section_id=s.id, item_id=g.id),
                    ops=[EditOp(op="set_skills", section_id=s.id, item_id=g.id, old=", ".join(g.skills), order=deduped)],
                ))

    summaries = [(s, i) for s in sections if s.type == "summary" for i in s.items if i.text.strip()]
    if not summaries:
        out.append(Suggestion(id=_sid("summary_missing"), kind="tip", priority=3, title="Add a short summary",
                              reason="Two to four sentences: who you are professionally, your strongest relevant experience, and what you are looking for."))
    for s, i in summaries:
        n = T.word_count(i.text)
        if n > 100:
            out.append(Suggestion(id=_sid("summary_long", i.id, str(n)), kind="tip", priority=3, title="Shorten your summary",
                                  reason=f"It has {n} words; about 30-90 reads best.", ref=Ref(section_id=s.id, item_id=i.id)))
        cl = T.cliches(i.text)
        if cl:
            out.append(Suggestion(id=_sid("cliche", i.id, *cl), kind="tip", priority=3, title="Replace clichés with evidence",
                                  reason=f"“{', '.join(cl)}” is said by many candidates. Show it with a concrete result instead.",
                                  ref=Ref(section_id=s.id, item_id=i.id)))
    order = {"remove_duplicate": 0, "dedupe_skills": 1, "remove_first_person": 2, "fix_tense": 3, "rewrite_weak": 4,
             "add_metric": 5, "rewrite_bullet": 6, "rewrite_summary": 7, "tip": 8}
    out.sort(key=lambda x: (x.priority, order.get(x.kind, 9)))
    return out
