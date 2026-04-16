# SmartKYC — 7-Minute Investor Pitch Script

---

## ⏱ SEGMENT 1 — The Problem (0:00–1:00)

"Every bank, every fintech, every institution onboarding a customer today is legally required to answer one question: *who is this person, and are they safe to do business with?*

That process — Know Your Customer — sounds simple. In practice, it's a nightmare.

Compliance teams spend hours manually reviewing passports, utility bills, and company registrations. They cross-reference sanction lists, PEP databases, and adverse media. They second-guess every decision because the consequences of getting it wrong — regulatory fines, reputational damage, even criminal liability — are severe.

The average KYC review today takes **3 to 5 business days** and costs institutions anywhere from **$30 to $150 per case**. For high-risk clients, multiply that by ten.

The industry is spending billions on a process that's still largely manual, inconsistent, and slow. There has to be a better way."

---

## ⏱ SEGMENT 2 — Introducing SmartKYC (1:00–2:00)

"That's why we built SmartKYC.

SmartKYC is an AI-powered compliance platform that automates the entire KYC and AML workflow — from document ingestion all the way through to a final risk verdict — in minutes, not days.

We handle every document type: passports, national IDs, driver's licences, utility bills, company registrations — **19 document schemas** covering the most common identity documents worldwide.

Our system reads a document, verifies the identity, cross-checks it against global watchlists, scans the web for adverse media, and produces a structured risk report — all without a compliance officer touching a single piece of paper.

For straightforward cases, we resolve them automatically. For complex or high-risk ones, we surface exactly the right information so a human officer can make a confident, defensible decision in minutes."

---

## ⏱ SEGMENT 3 — How It Works (2:00–4:00)

"Let me walk you through the platform.

**Step one: Case Creation.** A customer is onboarded — either through a direct intake form or via our AI chat interface, which can extract all required details from a natural language conversation.

**Step two: Document Upload.** The officer — or the customer directly — uploads a passport, ID, or supporting document. Our extraction pipeline kicks in immediately.

We use Google Gemini Vision as our primary extraction engine, achieving **96% field accuracy** on clean documents. For travel documents with machine-readable zones, our MRZ parser pushes that to **97%**. If a document is low quality or Gemini returns low confidence, we fall back automatically to Tesseract OCR, then MRZ parsing, then regex — a four-layer pipeline that handles everything from pristine scans to crumpled photographs.

**Step three: AI Investigation.** Once identity is confirmed, our multi-agent investigation engine fires up. Six specialised agents run in parallel and in sequence:

- **Sanctions Screening** — checks OFAC, UN, EU, and HM Treasury lists (30% weight)
- **PEP Check** — politically exposed person detection (25%)
- **Identity Verification** — cross-validates the document against submitted data (15%)
- **Registry Lookup** — company and director checks (15%)
- **Adverse Media Scan** — structured web intelligence (10%)
- **Transaction Analysis** — behavioural pattern review (5%)

The system calculates a live risk score as each agent completes. If any agent flags a score above 70, our LLM orchestrator evaluates whether to run additional optional agents — keeping the pipeline efficient without sacrificing thoroughness.

**Step four: Risk Verdict.** The case is assigned a final score: LOW, MEDIUM, HIGH, or CRITICAL. High and critical cases are routed to a compliance officer with a structured briefing. The officer sees the extracted document data, the agent findings, and can approve, reject, or escalate with a single action."

---

## ⏱ SEGMENT 4 — What Makes Us Different (4:00–5:30)

"Three things set SmartKYC apart.

**First: Accuracy you can audit.** Every field extracted from a document carries a confidence score. Every agent finding is sourced and traceable. When a regulator asks 'why did you approve this customer?' — you have a complete, timestamped audit trail. That's not just good practice; it's a regulatory requirement we've built in from day one.

**Second: Adaptive intelligence.** Our investigation isn't a fixed checklist. The orchestrator decides which agents to run based on the emerging risk picture. A low-risk domestic customer doesn't need the same scrutiny as a politically exposed person from a high-risk jurisdiction. We spend compute where it matters.

**Third: Human-in-the-loop by design.** We're not trying to replace compliance officers — we're giving them superpowers. For clear cases, we handle everything. For nuanced ones, we surface the right evidence so the officer makes the call in minutes, not days. The system flags discrepancies between what a customer declared and what the document says. It highlights mismatches. It brings the right information forward."

---

## ⏱ SEGMENT 5 — Market & Traction (5:30–6:15)

"The global KYC and AML compliance market is valued at over **$3.5 billion** and growing at 15% annually. Regulatory pressure isn't easing — it's intensifying. FATF updates, expanding sanctions regimes, and rising fines are forcing every financial institution to invest more in compliance infrastructure.

Our target customer is any institution that onboards individuals or businesses: banks, wealth managers, fintechs, crypto exchanges, law firms, real estate platforms.

SmartKYC reduces case review time from days to minutes. It cuts manual review costs by 60–80%. It reduces compliance team burnout. And it produces better, more consistent outcomes than human-only processes.

We're currently in active deployment and refining our offering based on real-world compliance workflows."

---

## ⏱ SEGMENT 6 — The Ask & Close (6:15–7:00)

"We're raising to accelerate go-to-market, expand our document schema coverage globally, and deepen integrations with the core banking and identity verification ecosystems our customers already use.

The compliance problem isn't going away. If anything, the stakes are getting higher. The institutions that win the next decade will be the ones that can onboard customers quickly, compliantly, and confidently.

SmartKYC is how they do that.

Thank you — I'd love to take your questions."

---

## 📌 Delivery Notes

| Segment | Time | Key Emotion |
|---|---|---|
| The Problem | 0:00–1:00 | Tension / urgency |
| Introducing SmartKYC | 1:00–2:00 | Relief / excitement |
| How It Works | 2:00–4:00 | Confidence / credibility |
| Differentiation | 4:00–5:30 | Conviction |
| Market & Traction | 5:30–6:15 | Momentum |
| The Ask | 6:15–7:00 | Vision / invitation |

**Pacing tip:** Aim for ~130 words per minute. This script is ~830 words — comfortable for 7 minutes with natural pauses.

**Slide cue:** Advance slides at the start of each segment heading.
