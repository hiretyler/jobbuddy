Write a single cover-letter intro paragraph for the role below, in the specified persona's voice. One paragraph. 2-3 sentences only. No greeting, no sign-off — just the paragraph body. Keep tailoring tight; this paragraph is followed by two canonical paragraphs that already cover Tyler's broader story, so do NOT repeat their content.

## Input

- Company: {{company}}
- Role: {{role}}
- Persona: {{persona}}

JD context:
```
{{jd_body}}
```

Up to 3 relevant master-bank facts (already filtered for this JD):
```
{{master_bank_relevant}}
```

## Voice cheatsheet — match the persona exactly

### variant1 — AI-Native Enablement & L&D Leader

This persona spans both the GTM/revenue facet and the broader internal employee L&D / remote-first / AI-adoption facet. Pick the second-sentence outcome that maps to whichever facet the JD leans on.

Opener: "Hi there - I'm Tyler Geddes, a GTM Enablement professional with 8+ years building revenue-linked programs for Sales and Customer Success teams at B2B SaaS companies."

Second sentence: lead with a CURRENT-ROLE outcome from Simpro (Tyler's current job) that maps tightly to the strongest JD signal — pick ONE, use it ONCE, do not stack multiple. Available facts (Simpro only — the Buildout 30% ramp and Apto churn/NPS outcomes now live verbatim in the canonical paragraph that follows, so do NOT cite them here or the letter repeats itself): 300+ attendee global Sales/AM Kickoff; MEDDICC Customer Success Excellence with certification milestones + activity-based metrics; competitive battlecards and role-based playbooks shipped across 4 product lines; AI content system on NotebookLM + Gemini that cut training production time 60%; custom enablement campaign creator on Claude + Google Apps Script; AI adoption workshops coaching Sales + CS reps to integrate Gemini into deal reviews. For an internal-L&D-leaning JD, favor the AI-content-system, campaign-creator, or AI-adoption-workshop facts. Reference {{company}} by name in this sentence to ground the connection.

### variant2 — Customer Education

Opener: "Hi there - I'm Tyler Geddes, a customer education professional with 8+ years building programs that turn onboarding into a retention strategy - replacing 1:1 training with scalable 1:many systems."

Second sentence: ONE concrete outcome mapped to the JD's strongest signal. Available facts: Apto onboarding cut time-to-value 50%; 1:Many webinars doubled attendance + 15% feature adoption (Apto); Sensera 150% YOY retention improvement; Zendesk Help Center cut support requests 50% (Sensera); customer education across 7 SaaS products at Buildout, Workramp from scratch, 20% retention improvement; KarmaCheck 80+ asset KB. Reference {{company}} by name in this sentence.

## Voice rules — all personas

- Hyphens, never em-dashes. Use " - " (space-hyphen-space) as the rhythmic punctuation.
- No marketing adjectives: no "passionate", "groundbreaking", "innovative", "transformative", "cutting-edge", "world-class", "best-in-class", "thrilled", "excited to".
- No emojis.
- Tight, declarative sentences. Lead with the outcome, then the mechanism.
- Reference the company by name once in the paragraph (e.g. "at {{company}}" or "for {{company}}'s GTM org") to show it isn't a form letter.
- Weave in 1-2 of the master-bank facts above where they fit the JD signal naturally. Don't force all 3 in.
- Match the persona's opener verbatim. The second sentence is the only one that should be tailored. A third sentence (one tight JD-tie observation) is optional, not required.

## Phrases banned from this paragraph (already used in the canonical paragraphs that follow)

Do NOT use any of these phrasings — they appear in the canonical follow-on paragraphs and would cause repetition in the final cover letter:

- "strategic partner to field leadership" or "content producer in the background"
- "customer education as infrastructure" or "not afterthought"
- "build enablement programs from scratch in ambiguous environments where structure doesn't yet exist"
- "I'd welcome the chance to talk" / "I'd welcome the chance to discuss"
- Any reuse of phrases such as "across the arc of my career", "every outcome anchored to", "anchored to sustained behavior change"
- Multi-company comparison or list-of-three-companies framing in a single sentence (e.g. "At X I did A, at Y I did B, at Z I did C")
- The Buildout outcome that now lives in the canonical follow-on paragraphs: any phrasing of the Buildout "30% ramp / ramp-time reduction", "MEDDICC company-wide", or "tracked through Salesforce and Gong".
- The Apto outcome that now lives in the canonical follow-on paragraphs: "10% churn reduction", "1.5 point NPS", or "unified Sales and CS retention strategy".
- The canonical opener wording from any persona's `.page > .body` paragraphs — adapt the persona opener provided above but do not echo deeper canonical sentences.

If a JD signal pulls you toward a banned phrase, find a different angle. Repetition with the canonical paragraphs is a HARD FAIL.

## Output

Return ONLY a single fenced JSON block. No prose before or after.

```json
{"cl_paragraph":""}
```
