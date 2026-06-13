Pick up to 3 mention bullets, VERBATIM, from the provided sources. These bullets get pasted into a short-answer field or into the experience section of Tyler's persona resume. Novelty is forbidden — you are selecting, not writing.

## Input

- Company: {{company}}
- Role: {{role}}
- Recommended persona: {{recommended_persona}}

JD context:
```
{{jd_body}}
```

Full master bank (17 entries with "Where it fits" metadata):
```
{{master_bank}}
```

Bullets from the OTHER two canonical personas (the ones NOT currently recommended for this role):
```
{{other_persona_bullets}}
```

## Source rules

Every bullet you output must come VERBATIM from exactly one of these two sources:

1. An entry in the master bank above.
2. A bullet appearing in the OTHER two canonical personas above.

DO NOT invent new bullets. DO NOT compose new bullets from fragments. DO NOT paraphrase. DO NOT add metrics that aren't already in the source bullet. DO NOT rewrite to fit the JD — match the persona's voice by selecting from the source verbatim.

If fewer than 3 strong-fit candidates exist verbatim across the bank and the other personas, return fewer. Better to return 2 verbatim than 3 with one fabricated.

## Selection rules

1. Read the JD. Identify the 2-4 strongest signals (specific tools, outcomes, motions, compliance/industry context).
2. Match those signals against the candidate bullets in the two sources above.
3. Pick the 1-3 candidates that, taken together, give the broadest defensible coverage of the JD's signals.
4. Each bullet must reference exactly ONE role from Tyler's career (HARD constraint). Do not select a bullet that composes achievements across multiple companies, and do not edit a multi-role bullet down to one role — skip it.
5. Honest framing: if the source entry says "contributor, not owner" or "evaluator-level, not admin," preserve that distinction. Don't upgrade.

## Voice rules

These are properties of the SOURCE bullets — do not enforce them by rewriting. If a candidate bullet violates these, do not select it.

- Hyphens, never em-dashes.
- No emojis.
- No marketing adjectives ("passionate", "thrilled", "excited to", "groundbreaking", "innovative", "world-class", "cutting-edge", "transformative").

## Hard constraints

- Up to 3 bullets, never more.
- Each bullet is one string in the JSON array, copied verbatim from a source above.
- Single-role anchoring: each bullet references exactly ONE role from Tyler's career.

## Output

Return ONLY a single fenced JSON block. No prose before or after. `bullets` is a JSON array of verbatim strings. Return fewer than 3 (or an empty array) if there are not enough strong-fit verbatim candidates.

```json
{"bullets":["",""]}
```
