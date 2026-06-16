# Slipstream — Business Plan & Direction

**The technical-sales execution copilot.** *Win the deal between the calls.*

> Lineage: selected by the GStack/Hermes **Weekly Opportunity Prototype Intake** on 2026-06-15
> as *"GTM Call-to-Action Copilot"* (niche: sales engineers / technical GTM; 119 pain signals /
> 8 days). Brought to life as **Slipstream** and grounded in [TRENDS-2026.md](./TRENDS-2026.md).

---

## 1. Mission
**Give every technical seller an AI teammate that turns each customer conversation into
grounded, ready-to-ship next steps — so deals move forward on evidence, not memory.**

A Sales Engineer's job is won and lost *between* the calls: the follow-up that answers the
hard technical question, the demo that's prepped for the right stakeholders, the security
questionnaire returned in hours not weeks. That work is manual, repetitive, and buried in
transcripts and docs. Slipstream does it in 60 seconds — and **cites its evidence for every
claim**, because in technical sales a confident wrong answer is worse than no answer.

## 2. Why now (the racing line through 2026)
1. **Revenue *execution*, not intelligence.** The market is done buying dashboards; it wants
   completed work. Slipstream ships the email, the checklist, the CRM fields, the RFP rows.
2. **Copilot → agent.** Buyers want the workflow finished end-to-end. We start as a copilot
   and walk a credible path to autonomous follow-up drafting.
3. **Per-seat is dying; usage-based is winning.** We lead bottom-up and free, and monetize on
   value (calls processed, grounding library, seats) — not a $1,500/seat enterprise gate.
4. **The SE niche is unowned.** Gong/Clari serve AEs and managers; RFP tools own one
   questionnaire. The SE's full *call → action* loop has no owner. We take it.

## 3. Ideal Customer Profile (ICP) & product–market fit thesis
- **Primary persona:** Sales Engineer / Solutions Consultant / Solutions Architect at a B2B
  software company (Seed → mid-market; 5–200-person GTM org).
- **Buyer evolution:** individual SE (PLG) → SE team lead → VP Sales Engineering / RevOps.
- **The pain (verbatim from research):** 20+ hours per RFP × 4–5 concurrent deals; answers
  buried in Slack/Confluence/old recordings; the most valuable people doing the most
  repetitive work.
- **PMF hypothesis:** *An SE who pastes one real discovery-call transcript and gets a
  grounded, send-ready follow-up + demo-prep checklist + pre-filled security/RFP rows will
  come back the next working day.* We instrument **D1/D7 return on a pasted transcript** and
  **"exports per active SE per week"** as our two leading PMF signals.

## 4. Product
### What it does (MVP — built in this repo)
Paste a transcript or discovery notes → Slipstream returns a **grounded action queue**:
1. **Deal brief** — pains, stakeholders (with roles), use cases, objections, competitors.
2. **Technical requirements** — integrations, security/compliance asks, scale constraints,
   open questions — each tagged with the **evidence span** it came from.
3. **Next-step action queue** — prioritized, owner-tagged, due-dated.
4. **Send-ready follow-up email** — drafted in the seller's voice, every technical claim
   cited to a transcript line.
5. **Demo / POC prep checklist** — tailored to the stakeholders and requirements surfaced.
6. **RFP / security-questionnaire seed rows** — extracted asks formatted to paste/auto-fill.
7. **CRM-ready fields + one integration stub** — JSON/CSV + webhook export with a
   HubSpot/Salesforce field map.

### The moat: grounding by construction
Every structured output carries a `source` pointing at the transcript span (and, later, the
doc) it was derived from. No evidence → it's flagged "unverified," never asserted. This is the
direct answer to the #1 SE objection and the thing generic summarizers won't do.

### Roadmap
| Horizon | Ship |
|---|---|
| **Now (MVP)** | Local runnable app: paste → grounded action queue → export. LLM-optional (deterministic fallback so it always runs). |
| **30 days** | Hosted web app + auth; save deals; **grounding library** (upload product/security docs → answers cite them). |
| **60 days** | CRM write-back (HubSpot/Salesforce), Slack delivery, RFP/questionnaire pre-fill from library. |
| **90 days** | **Agentic mode** (auto-draft & queue follow-ups), team analytics, SSO/security review pack. |

## 5. Business model & pricing (hybrid, per 2026 monetization reality)
| Tier | Price | For | Limits |
|---|---|---|---|
| **Free** | $0 | Individual SE, the wedge | 5 calls/mo, manual export |
| **Pro** | **$39/seat/mo** | Active SE | 100 calls/mo incl., CRM export |
| **Team** | **$79/seat/mo** | SE team | Shared grounding library, RFP pre-fill, Slack/CRM sync, analytics |
| **Enterprise** | Custom (usage + platform fee) | VP SE / RevOps | SSO, on-prem grounding, security review, volume call-credits |

Overage on calls billed as **credits** (usage-based) above tier caps — adoption is never
penalized. Land-and-expand: 1 SE → SE team (avg ~8) → AE+SE deal pod.

## 6. Revenue path & unit economics
- **Expansion ladder:** single seat (~$470–950 ARR) → SE team (~$4–9K ARR) → org (~$15–30K ARR).
- **Year-1 target:** 5,000 free signups → ~3% paid conversion → ~150 paid seats /
  ~50 paying teams at ~$6K blended ACV ≈ **$300K ARR**, founder-led + PLG.
- **Gross margin:** LLM inference ≈ **$0.05–0.30 per processed call** (Claude Haiku/Sonnet
  tier); a $39–79 seat processing tens of calls/mo runs **85%+ gross margin**.
- **CAC discipline:** bottom-up PLG keeps S&M low (AI-first companies run lower S&M-%-revenue);
  content + SE-community-led growth, founder sales only for Team/Enterprise.

## 7. Go-to-market
1. **Wedge (PLG):** free "paste a transcript" tool; outputs are shareable inside the GTM org,
   so usage spreads SE → SE and SE → AE.
2. **Content & community:** "RFP in minutes," demo-prep templates, SE-ops playbooks; show up
   where SEs are (Slack communities, LinkedIn, presales forums).
3. **Founder-led sales** for Team/Enterprise: target VP Sales Engineering at Series A–C SaaS.
4. **Integrations as distribution:** HubSpot/Salesforce/Slack marketplaces once CRM sync ships.

## 8. Moats & defensibility
- **Grounding/citation engine** (technical trust) + **SE-native workflow** (not retrofitted CI).
- **Compounding grounding library** per customer (their own verified answers) = switching cost.
- **Usage data** on what technical objections actually move deals → proprietary playbooks.

## 9. Risks & mitigations
| Risk | Mitigation |
|---|---|
| Incumbents (Gong) add an SE module | Be SE-native and faster; own the execution layer they treat as a feature. |
| Hallucination erodes trust | Grounding-by-construction; "unverified" flag; never assert without evidence. |
| Per-seat compression | Hybrid usage pricing from day one; value-metric = calls/work shipped. |
| Data security objections | On-prem/no-retention grounding tier; SOC2 path in the 90-day plan. |

## 10. The ask / next 30 days
Ship the hosted MVP, get **10 design-partner SEs** pasting real transcripts weekly, and
validate the PMF signal (D7 return + exports/SE/week). The working prototype in this repo is
step one.
