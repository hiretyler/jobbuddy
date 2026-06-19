Score a full job description against three target personas in one pass. The full JD body is below. This is the authoritative score - there is no later rescore.

## Input

- Company (captured guess): {{company}}
- Role (captured guess): {{role}}
- Location: {{location}}
- ATS URL: {{ats_url}}

Full JD body:
```
{{jd_body}}
```

## Location check — do this FIRST, before reading persona definitions

Read the `Location:` field above, and scan the JD body for a location/work-arrangement statement. Tyler is in Fort Collins, CO, and is REMOTE-ONLY.

ACCEPTABLE: fully remote ONLY. Examples that pass: "Remote", "Remote - United States", "Fully Remote", "Remote (US)", "Anywhere", "United States (Remote)", "Remote, US".

NOT ACCEPTABLE (any of these triggers the cap):
- ANY hybrid arrangement, including hybrid within Colorado (e.g. "Denver (Hybrid)", "Boulder Hybrid", "Fort Collins (Hybrid)")
- ANY onsite/in-office requirement anywhere
- ANY mandatory office days (even "1-2 days per week in office")
- Any role requiring relocation or commute

Hybrid is NEVER acceptable, even if the city is in Colorado. Remote-only, full stop.

If location is NOT ACCEPTABLE: cap ALL persona scores at 4.0 before evaluating fit, and note the specific reason in the top reason text (e.g. "hybrid in Denver", "onsite NYC required", "2 days/week in Austin office", "relocation to Boston required"). Do not let strong persona signals override this cap.

If location is ambiguous (e.g. just "United States" with no remote/hybrid/onsite indicator): treat as acceptable but cap at 7.5 max and flag "location ambiguous - verify fully remote" in the top reason.

## Personas

### variant1 — GTM / Revenue Enablement

Target role family: Sales enablement, Revenue enablement, GTM enablement, Sales-Methodology PM, RevOps-adjacent enablement.

Strong matches: MEDDICC / MEDDPICC / sales methodology certification, Sales Kickoff (SKO) / GTM Kickoff / revenue kickoff, pipeline velocity, deal review, opportunity coaching, sales onboarding, AE/BDR/SDR ramp time, competitive battlecards, role-based playbooks, talk tracks, Gong call review, Salesforce activity metrics, Highspot, cross-functional with RevOps / Product Marketing / field leadership, Account Management / Customer Success enablement tied to renewal & expansion, product launch readiness, train-the-trainer.

Anti-triggers: pure customer-facing education / Help Center / Pendo / Intercom-heavy → variant2. Internal L&D for non-revenue functions, async-only / no live facilitation, fully remote-first / build-from-scratch-in-ambiguity → variant3.

### variant2 — Customer Education

Target role family: Customer Education, Customer Enablement, Customer Onboarding PM, Product Education, Learning Programs (customer-facing).

Strong matches: customer onboarding, time-to-value / time-to-first-value (TTFV), churn reduction, retention strategy, NPS improvement, 1:Many webinar delivery, scalable customer training, Help Center architecture, in-app content / in-app guidance, Pendo, Intercom, Zendesk, Articulate, Camtasia, Customer University / Academy / certification program, customer lifecycle stages, post-live adoption tracks, sales-to-CS handoff, knowledge base, how-to video library, technical writing.

Anti-triggers: sales-team-facing enablement, MEDDICC, battlecards, AE/BDR onboarding → variant1. Internal employee L&D, remote-first culture / AI-adoption focus → variant3. No customer-facing component at all → variant3 (internal L&D), not variant2.

### variant3 — Internal / Distributed / AI-Native Enablement

Target role family: Internal Enablement, Employee L&D, Remote Operations Enablement, AI Enablement, Learning Programs at distributed orgs.

Strong matches: remote-first / fully distributed / async-first / globally distributed teams, AI adoption / AI fluency / AI-augmented workflows / prompt engineering coaching, behavior change at scale, sustained reinforcement (vs one-time training), drip-style enablement / async delivery / microlearning / just-in-time learning, communities of practice / champion networks / peer-driven learning, build-from-scratch / ambiguous environment / no LMS / greenfield enablement, change management / organizational change, cohort performance analysis / engagement analytics / behavior measurement, VILT / remote facilitation / async-live blend, Slack-native enablement / in-tool delivery / lightweight infrastructure.

Anti-triggers: heavy Sales methodology / MEDDICC / battlecards / SKO focus → variant1. Customer-facing onboarding, Help Center, churn reduction, Pendo / Intercom → variant2. Highly in-person / office-based culture → disqualify on location.

## Hard rule — variant1 anti-pattern calibration

This rule overrides any apparent density of sales-methodology language:

> A **high variant1 score (≥8) requires the JD to touch BOTH a sales-methodology dimension AND a customer/partner-facing OR revenue-cycle component**. Pure sales-methodology training without a customer/AM/CS/partner touchpoint over-indexes on fast rejection in the historical data — score it 6-7 max even when MEDDICC/SKO/battlecard phrases are dense.

Apply literally. Evidence for the customer/partner/revenue-cycle component must be explicit in the JD text, not assumed.

Analogous caps:
- variant2 capped at 6.5 if the JD is pure CS execution (renewals, health scoring, save motions) with no customer-facing onboarding/training/education/content/Help-Center scope.
- variant3 capped at 6.5 if the JD is generic corporate L&D with no remote-first, AI-adoption, behavior-change-at-scale, or build-from-scratch signal.

## Disqualifier scan (run this against the full body)

Flag and incorporate into reasons / score where present:

1. **Years/skills requirement Tyler doesn't have**: "5+ years of X required" where X is a platform or motion Tyler hasn't owned (e.g. 5+ years Skilljar admin, 5+ years Force Management certification ownership, 5+ years quota-carrying sales). Drop the top score by 1.0-2.0 and note in the top reason.
2. **Location mismatch**: handled by the Location check above (cap ≤4.0). Re-confirm against the body and note the specific reason.
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

- Score each persona from 0 to 10 in 0.5 increments. Half-points are real scores.
- 0-3: clear mismatch. 4-5: adjacent but weak. 6-7: solid fit. 8-9: strong fit with multiple distinct trigger phrases. 10: textbook exemplar.
- One-line reason per persona, ≤120 characters. Paraphrase the JD phrase that drove the score.
- Pick the top persona by highest score. Break ties variant1 > variant2 > variant3.

## Company name

Identify the hiring company - the organization that would actually employ this person - as named in the JD body (often the first sentence, e.g. "Acme is a ...", "At Acme, we ...", "Join Acme's team"). Put it in the `company` field.

- Return an empty string if the JD does not clearly name the employer.
- NEVER return a job board (LinkedIn, BuiltIn, Indeed, Otta, Wellfound, Glassdoor, ZipRecruiter), an ATS vendor (Greenhouse, Lever, iCIMS, Workday, Ashby, Eightfold), or a region/location token (e.g. "AMER", "EMEA", "US-Nationwide", "Nationwide", "Remote", "US").
- Prefer the clean brand name ("Quest", "Toast"), not a legal suffix or marketing tagline.

## Job title

Put the posted job title in the `role` field, cleaned up.

- The `Role:` input above is the captured title. If it looks like the real posted title, just clean it: strip any trailing company name, location, or job-board suffix (e.g. "AI Enablement & Adoption Manager | Nimble Gravity | LinkedIn" -> "AI Enablement & Adoption Manager").
- If the captured Role is junk (e.g. "Application", "Apply", a URL fragment, or just a company name), derive the actual title from the JD body instead.
- Do not invent or paraphrase - prefer the exact posted wording. Return an empty string only if no title can be determined.

## Output

Return ONLY a single fenced JSON block with this exact shape. No prose before or after.

```json
{"company":"","role":"","variant1":{"score":0,"reason":""},"variant2":{"score":0,"reason":""},"variant3":{"score":0,"reason":""},"top":{"persona":"variant1","score":0,"reason":""}}
```
