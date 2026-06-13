Recommend latent-strength SWAPS to improve the match between Tyler's active persona resume and the JD below. The resume is fixed at ~2 pages, so every ADD must be paired with a REMOVE. This is a STRICTLY-FROM-BANK recommender: every added bullet and skill comes VERBATIM from the candidate pools below. No novelty, no paraphrasing, no metric edits, no invented experience.

## Input

- Company: {{company}}
- Role: {{role}}
- Active persona: {{recommended_persona}} ({{persona_name}})

JD context:
```
{{jd_body}}
```

Current bullets in the active persona resume (JSON array, verbatim):
```
{{current_bullets}}
```

Current skills in the active persona resume (JSON array, verbatim):
```
{{current_skills}}
```

ADD-bullet candidates (from the master bank, scoped to this persona). Each has a `text` (the verbatim bullet), the JD-keyword `tags` it satisfies, a `claim_level` (the truthful depth Tyler can assert), the `role` it belongs to, and an optional `metric`:
```
{{add_bullet_candidates}}
```

ADD-skill candidates (from the master bank, scoped to this persona):
```
{{add_skill_candidates}}
```

REMOVE candidates (the lowest-priority current bullets - first to go when a JD-relevant strength needs the slot). Each has a `locator` (a substring identifying which current bullet it refers to) and a `rationale`:
```
{{removal_candidates}}
```

PROTECTED bullets (NEVER remove these, even for a perfect JD match). Identified by `locator`:
```
{{protected_bullets}}
```

Bank hard constraints (obey all):
```
{{hard_constraints}}
```

## Task

1. Identify the JD's most important keywords/requirements (skills, tools, methodologies, motions, platforms, compliance terms, domain).
2. For each requirement NOT already covered by `current_bullets` or `current_skills`, look for an ADD candidate whose `tags` include that keyword:
   - Bullet swap: pick an `add_bullet_candidates` entry that gains the missing keyword AND whose `claim_level` honestly supports what the JD asks (do NOT add an `admin`-level claim when the JD demands ownership Tyler cannot assert, etc.). Pair it with a REMOVE: choose the `replace` from `current_bullets` (VERBATIM), preferring a current bullet whose text contains a `removal_candidates` `locator`. Output `{ replace, with, reason, claim_level, role }`.
   - Skill swap: pick an `add_skill_candidates` entry that gains the missing keyword. Pair it with a `remove` from `current_skills` (VERBATIM) that is weakly relevant to this JD. Output `{ remove, add, reason }`.
3. The `reason` field names the JD keyword/requirement gained, e.g. `"gains 'Zendesk admin' - JD requires Help Center ownership"`.

## Hard constraints

- NEVER add without removing. Output is strictly swaps.
- Every `with` value is VERBATIM the `text` of an `add_bullet_candidates` entry. Every `add` value is VERBATIM the `skill` of an `add_skill_candidates` entry. No paraphrasing, no edits, no metric tweaks.
- Every `replace` value is VERBATIM from `current_bullets`. Every `remove` (skill) value is VERBATIM from `current_skills`.
- NEVER pick a `replace` whose text matches a PROTECTED bullet `locator`.
- Conditional protection: if a REMOVE candidate carries `protected_unless_no_tag`, only use it as a `replace` when the JD contains NONE of those tags. (E.g. the Sensera Zendesk Help Center bullet stays unless the JD has no Zendesk / support-platform / help-center signal.)
- Honor `claim_level`: never recommend an ADD that would over-claim relative to what the JD demands and what Tyler can truthfully assert.
- Each bullet references exactly ONE role. Never select or compose across companies.
- Max 3 bullet swaps and 3 skill swaps. Quality over quantity - output zero rather than weak swaps. If the persona already covers the JD, return empty arrays.
- Hyphens, never em-dashes. No emojis.

## Output

Return ONLY a single fenced JSON block. No prose before or after.

```json
{
  "bullet_swaps": [
    { "replace": "verbatim current bullet", "with": "verbatim add-candidate text", "reason": "gains 'X' - why", "claim_level": "admin", "role": "Sensera Systems" }
  ],
  "skill_swaps": [
    { "remove": "Current Skill", "add": "Candidate Skill", "reason": "gains 'Y'" }
  ]
}
```

If no swaps are warranted, return `{"bullet_swaps": [], "skill_swaps": []}`.
