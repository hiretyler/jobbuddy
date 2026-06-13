Score this job snippet against two target personas. The snippet is an email alert excerpt (subject + body), so signal is sparse — be honest about what is and isn't supported by the text.

## Input

- Company: {{company}}
- Role: {{role}}
- Location: {{location}}
- ATS URL: {{ats_url}}

Snippet:
```
{{snippet}}
```

## Location check — do this FIRST, before reading persona definitions

Read the `Location:` field above. Tyler is in Fort Collins, CO.

ACCEPTABLE: fully remote ONLY. Examples that pass: "Remote", "Remote - United States", "Fully Remote", "Remote (US)", "Anywhere", "United States (Remote)", "Remote, US".

NOT ACCEPTABLE (any of these triggers the cap):
- ANY hybrid arrangement, including hybrid within Colorado (e.g. "Denver (Hybrid)", "Boulder Hybrid", "Fort Collins (Hybrid)")
- ANY onsite/in-office requirement anywhere
- ANY mandatory office days (even "1-2 days per week in office")
- Any role requiring relocation or commute
- Multi-city listings that include hybrid/onsite as the only options

Hybrid is NEVER acceptable, even if the city is in Colorado. Remote-only, full stop.

If location is NOT ACCEPTABLE: your maximum score for ANY persona is 5.5. Apply this cap before you evaluate persona fit. Note the specific reason in the top reason text (e.g. "hybrid in SF", "hybrid in Denver", "onsite NYC required", "1-2 office days/week"). Do not let strong persona signals override this cap.

If location is ambiguous (e.g. just "United States" with no remote/hybrid/onsite indicator): treat as acceptable but cap at 7.5 max, and flag "location ambiguous - verify fully remote" in your reason.

If location is NOT ACCEPTABLE, you may stop detailed persona analysis and assign low scores (≤5.5) across the board with the location reason.

## Personas

### variant1 — AI-Native Enablement & L&D Leader

Target role family: GTM / Revenue / Sales enablement, AND internal employee L&D, learning programs, remote-first enablement, AI-adoption enablement, build-from-scratch enablement at distributed orgs. This persona spans both the GTM facet and the broader internal Enablement & L&D facet.

Strong-match trigger phrases:
- MEDDICC / MEDDPICC / sales methodology certification
- Sales Kickoff (SKO), GTM Kickoff, revenue kickoff
- Pipeline velocity, deal review, opportunity coaching
- Sales onboarding, AE / BDR / SDR ramp time
- Competitive battlecards, role-based playbooks, talk tracks
- Gong call review, Salesforce activity metrics, Highspot
- Cross-functional with Revenue Operations, Product Marketing, field leadership
- Account Management / Customer Success enablement tied to renewal & expansion
- Internal employee L&D / learning programs for non-revenue functions
- Remote-first, fully distributed, async-first, globally distributed teams
- AI adoption, AI fluency, AI-augmented workflows, prompt engineering coaching
- Behavior change at scale, sustained reinforcement (vs one-time training)
- Drip-style enablement, async delivery, microlearning, just-in-time learning
- Communities of practice, champion networks, peer-driven learning
- Build from scratch / ambiguous environment / no LMS / greenfield enablement
- Change management, organizational change, cohort engagement analytics
- VILT, remote facilitation, Slack-native / in-tool delivery

Anti-triggers (push to a different persona):
- Pure customer-facing education / Help Center architecture / Pendo / Intercom-heavy → variant2

### variant2 — Customer Education

Target role family: Customer Education, Customer Enablement, Customer Onboarding PM, Product Education, Learning Programs (customer-facing).

Strong-match trigger phrases:
- Customer onboarding, time-to-value, time-to-first-value (TTFV)
- Churn reduction, retention strategy, NPS improvement
- 1:Many webinar delivery, scalable customer training
- Help Center architecture, in-app content, in-app guidance
- Pendo, Intercom, Zendesk, Articulate, Camtasia
- Customer Education / Customer University / Customer Academy / certification program
- Customer lifecycle stages, post-live adoption tracks
- Sales-to-CS handoff design
- Knowledge base, technical writing, how-to video library

Anti-triggers (push to a different persona):
- Sales-team-facing enablement, MEDDICC, battlecards, AE/BDR onboarding → variant1
- Internal employee L&D, remote-first culture/AI-adoption focus → variant1
- No customer-facing component → variant1 (internal L&D territory), not variant2
- Pure CS work without customer-facing onboarding/training is not variant2 — route to variant1 if it has an internal-enablement frame

## Scoring rules

- Score each persona from 0 to 10 in 0.5 increments. Half-points are encouraged — 6.5 and 7.5 are real scores.
- 0-3: clear mismatch. 4-5: adjacent but weak. 6-7: solid fit. 8-9: strong fit with multiple distinct trigger phrases. 10: textbook exemplar.
- One-line reason per persona, ≤120 characters. Quote or paraphrase the snippet phrase that drove the score.

## Hard rule — variant1 anti-pattern calibration

This rule overrides any apparent density of sales-methodology language:

> A **high variant1 score (≥8) requires the JD to touch BOTH a sales-methodology dimension AND a customer/partner-facing OR revenue-cycle component**. Pure sales-methodology training without a customer/AM/CS/partner touchpoint over-indexes on fast rejection in the historical data — score it 6-7 max even when MEDDICC/SKO/battlecard phrases are dense.

Apply this rule literally. If the snippet is heavy on MEDDICC/SKO/battlecards but mentions no customer-facing, AM, CS, partner, or renewal/expansion/retention dimension, cap variant1 at 7.0.

Analogous cap for the other persona:
- variant2: if the snippet describes pure CS work (health scores, save calls, renewals) with no customer-facing onboarding, training, education, or content/help-center component, cap variant2 at 6.5 and route to variant1.

## Source signal — soft adjustment

- Snippet from a known job board (LinkedIn, Indeed, Otta, Wellfound, Glassdoor, ZipRecruiter) is neutral — no adjustment.
- Recruiter-direct email (no job-board origin, addressed to a candidate, mentions reaching out / interest / sourcing): apply a +0.5 floor on the top persona's score (i.e. raise it to at least the original score + 0.5, capped at 10).

## Output

Pick the top persona (highest score; ties broken by which persona has the cleaner trigger-phrase match in the snippet, not by score-rounding).

Return ONLY a single fenced JSON block with this exact shape. No prose before or after.

```json
{"variant1":{"score":0,"reason":""},"variant2":{"score":0,"reason":""},"top":{"persona":"variant1","score":0,"reason":""}}
```
