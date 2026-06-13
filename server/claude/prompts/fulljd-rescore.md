Rescore a full job description against two target personas. This is a higher-confidence pass than the snippet score — the full JD body is below. Use it to confirm or correct the snippet-tier scoring.

## Input

- Company: {{company}}
- Role: {{role}}
- Location: {{location}}
- ATS URL: {{ats_url}}
- Snippet-tier score (for context): {{snippet_score}}
- Snippet-tier recommended persona: {{recommended_persona_from_snippet}}

Full JD body:
```
{{jd_body}}
```

## Personas

### variant1 — AI-Native Enablement & L&D Leader

Spans the GTM facet AND the broader internal Enablement & L&D facet (internal employee L&D, remote-first enablement, AI-adoption enablement, build-from-scratch programs at distributed orgs).

Strong matches: MEDDICC / MEDDPICC, Sales Kickoff (SKO), pipeline velocity, deal review, AE/BDR/SDR ramp, competitive battlecards, role-based playbooks, Gong call review, Salesforce, Highspot, RevOps partnership, Product Marketing partnership, Account Management / CS enablement tied to renewal & expansion. ALSO: internal employee L&D / learning programs for non-revenue functions, remote-first / fully distributed / async-first, AI adoption / AI fluency / AI-augmented workflows / prompt engineering coaching, behavior change at scale, sustained reinforcement, drip-style / microlearning / just-in-time, communities of practice, champion networks, greenfield / build-from-scratch / no LMS, change management, cohort engagement analytics, VILT, Slack-native enablement.

Anti-triggers: pure customer-facing education / Help Center / Pendo / Intercom-heavy → variant2.

### variant2 — Customer Education

Strong matches: customer onboarding, time-to-value (TTFV), churn reduction, retention strategy, NPS, 1:Many webinars, scalable customer training, Help Center architecture, in-app content, Pendo, Intercom, Zendesk, Articulate, Camtasia, Customer University / Academy, customer certification, lifecycle stages, sales-to-CS handoff, KB and how-to video library.

Anti-triggers: sales-team-facing enablement, MEDDICC, battlecards, AE/BDR onboarding → variant1. Internal employee L&D, remote-first / AI-adoption focus → variant1. Pure CS work with no customer-facing onboarding/training/education → variant1. No customer-facing component at all → variant1 (internal L&D), not variant2.

## Hard rule — variant1 anti-pattern calibration

This rule overrides any apparent density of sales-methodology language:

> A **high variant1 score (≥8) requires the JD to touch BOTH a sales-methodology dimension AND a customer/partner-facing OR revenue-cycle component**. Pure sales-methodology training without a customer/AM/CS/partner touchpoint over-indexes on fast rejection in the historical data — score it 6-7 max even when MEDDICC/SKO/battlecard phrases are dense.

Apply literally. With full JD body in hand, evidence for the customer/partner/revenue-cycle component must be explicit in the JD text, not assumed.

Analogous cap:
- variant2 capped at 6.5 if the JD is pure CS execution (renewals, health scoring, save motions) with no customer-facing onboarding/training/education/content/Help-Center scope.

## Disqualifier scan (run this against the full body)

Flag and incorporate into reasons / score where present:

1. **Years/skills requirement Tyler doesn't have**: "5+ years of X required" where X is a platform or motion Tyler hasn't owned (e.g. 5+ years Skilljar admin, 5+ years Force Management certification ownership, 5+ years quota-carrying sales). Drop the top score by 1.0-2.0 and note in the top reason.
2. **Location mismatch**: Tyler is REMOTE-ONLY. The ONLY ACCEPTABLE location is fully remote (e.g. "Remote", "Remote - United States", "Fully Remote", "Anywhere", "Remote (US)"). ANY hybrid arrangement is a disqualifier - including hybrid within Colorado (Denver Hybrid, Boulder Hybrid, etc.). ANY onsite/in-office requirement is a disqualifier. ANY mandatory office days is a disqualifier (even "1-2 days per week in office"). ANY relocation or commute requirement is a disqualifier. Hybrid is NEVER acceptable, period. Drop top score to ≤4 and note the specific reason in the disqualifier text (e.g. "hybrid in Denver", "hybrid in SF", "onsite NYC required", "2 days/week in Austin office", "relocation to Boston required").
3. **Seniority mismatch**: junior IC ramp roles (<3 yrs) and VP+ leadership roles (Director-of-Directors, VP, Head-of with 8+ reports) are mismatches — drop top score to ≤5 and note "seniority" in the reason.
4. **Industry/clearance disqualifiers**: US security clearance required, US-citizen-only roles where Tyler doesn't qualify, on-call engineering rotations.

## Plus scan (run this against the full body)

Note in the top reason if any of these are present, and consider a +0.5 to +1.0 bump on the top score:

- Explicit AI / Claude / Gemini / LLM / GenAI in the stack, not just buzzword
- Remote-first culture statement (not just "remote optional")
- Enablement-adjacent outcome metrics: time-to-value, ramp time, time-to-proficiency, cohort engagement, sustained behavior change
- Build-from-scratch / greenfield / ambiguous-environment framing
- Cross-functional with Product Marketing or RevOps explicitly named

## Scoring rules

- Score each persona from 0 to 10 in 0.5 increments.
- One-line reason per persona, ≤120 characters.
- Pick top persona by highest score, ties broken by trigger-phrase density.

## Output

Return ONLY a single fenced JSON block. No prose before or after. Be terse — this runs under a 5-second wall-time budget.

```json
{"variant1":{"score":0,"reason":""},"variant2":{"score":0,"reason":""},"top":{"persona":"variant1","score":0,"reason":""}}
```
