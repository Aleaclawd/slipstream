# Slipstream

**The technical-sales execution copilot.** *Win the deal between the calls.*

Slipstream turns a technical sales call into a **grounded action queue**: the
follow-up email, the demo/POC prep checklist, security-questionnaire & RFP seed
rows, and CRM-ready fields — with the **transcript evidence behind every claim.**
No evidence → it's flagged *unverified*, never asserted. In technical sales a
confident wrong answer is worse than no answer, so grounding is a first-class
feature, not an afterthought.

> **Lineage.** Selected by the GStack/Hermes *Weekly Opportunity Prototype
> Intake* (2026-06-15) as *"GTM Call-to-Action Copilot"* for the underserved
> sales-engineer / technical-GTM niche (119 real pain signals over 8 days), then
> brought to life and grounded in current market reality. See
> [`docs/TRENDS-2026.md`](docs/TRENDS-2026.md) and
> [`docs/BUSINESS-PLAN.md`](docs/BUSINESS-PLAN.md).

---

## Why it exists

A Sales Engineer's job is won and lost *between* the calls — the follow-up that
answers the hard technical question, the demo prepped for the right stakeholders,
the security questionnaire returned in hours not weeks. The 2026 market has moved
from *revenue intelligence* (dashboards) to *revenue **execution*** (shipped
work), incumbents (Gong/Clari) are priced for AE managers, and the #1 objection
to AI in this workflow is hallucination. Slipstream is built for that gap:
SE-native, execution-first, and grounded by construction.

## Quickstart

No build step, no required dependencies — just Node 18+.

```bash
cd slipstream
npm start          # → http://localhost:3210
```

Open the page, click **Load sample call**, then **Build action queue →**.

Run the engine tests:

```bash
npm test           # node --test
```

### Optional: Claude enrichment

The deterministic engine always runs offline. For higher-quality extraction,
install the SDK and set a key — the same grounded contract is returned, with
better language understanding:

```bash
npm install @anthropic-ai/sdk
export ANTHROPIC_API_KEY=sk-ant-...
# default model is claude-sonnet-4-6 (quality + structured output at SaaS unit cost);
# SLIPSTREAM_MODEL=claude-haiku-4-5 for the budget tier, or claude-opus-4-8 for premium.
npm start
```

Then tick **Use Claude** in the UI (it silently falls back to the deterministic
engine if the key/SDK is missing).

## How it works

```
transcript ──▶ engine.js (deterministic, grounded)         ┐
            └▶ llm.js   (optional Claude, same contract)   ├▶ ExtractionResult ──▶ UI + exports
                                                            ┘     (every item carries evidence)
```

- **`src/schema.js`** — the `ExtractionResult` contract: summary, stakeholders,
  pains, requirements (integration / security / scale / commercial / open
  questions), objections, competitors, action queue, follow-up email, demo prep,
  RFP/security seed rows, CRM fields. Every finding carries an `evidence` span
  `{quote, line, speaker, ts}`.
- **`src/engine.js`** — zero-dependency heuristic extractor; parses the
  transcript into utterances and grounds each finding in the line it came from.
- **`src/llm.js`** — optional Claude path using structured outputs
  (`output_config.format`) and the same schema.
- **`src/server.js`** — tiny Node HTTP server: the SPA + `/api/extract` and
  CSV / JSON / CRM-webhook exports.
- **`web/`** — the single-page app.

### Exports & integration

- **CSV** — the action queue + RFP rows.
- **JSON** — the full grounded result.
- **CRM webhook (stub)** — returns the exact HubSpot/Salesforce-shaped payload
  and a ready-to-run `curl`. It deliberately makes **no outbound call** in the
  MVP; wiring real delivery is the 60-day milestone in the business plan.

## Roadmap

MVP (this repo) → hosted app + grounding library (30d) → CRM write-back + RFP
pre-fill (60d) → agentic auto-follow-up + SSO/security (90d). Full plan in
[`docs/BUSINESS-PLAN.md`](docs/BUSINESS-PLAN.md).

## Running live

A staging instance runs under pm2 on the host (`127.0.0.1:3210`, deterministic
engine). Public cutover (`slipstream.apit.fun`) + the nginx vhost and pm2 config
are in [`deploy/`](deploy/) — see [`deploy/DEPLOY.md`](deploy/DEPLOY.md).

```bash
pm2 start ecosystem.config.cjs && pm2 save
```

## License

MIT — see [`LICENSE`](LICENSE).
