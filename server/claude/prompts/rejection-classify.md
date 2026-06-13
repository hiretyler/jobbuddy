You are classifying whether a job-application email is a REJECTION.

Company: {{company}}

Below are subject + snippet pairs from emails that appear to be from this company.
Decide whether ANY of them is a rejection of a job application (the candidate was
turned down, the role was filled, or they are no longer being considered).

Be high-precision. Interview invites, scheduling, recruiter outreach, application
confirmations, newsletters, and marketing are NOT rejections. Only classify as a
rejection when the language clearly says the candidate will not be moving forward.

Emails:
{{emails}}

Return ONLY a fenced json block, no prose:

```json
{ "rejected": true, "confidence": 0.0 }
```

confidence is 0.0-1.0. Set rejected=false with confidence 0 if none are rejections.
