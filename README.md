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
SE-native, execution-first, and **grounded by construction** — every finding either cites the
transcript line it came from or is flagged "unverified" and never asserted. That contract holds
in both engines: the zero-dependency deterministic baseline (instant, offline, lower recall)
and the optional Claude path (higher recall, same grounding rule).

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

### Views

The result opens in a tabbed workspace, every item grounded to a transcript line:

- **Brief** — pains, requirements, objections, competitors, demo/POC prep, RFP/security seed rows, follow-up email, CRM fields
- **Mind Map** — radial map of the deal (pains, stakeholders, requirements, competitors, next steps)
- **Kanban** — action board (Now / Next / Later), drag cards; teal = call commitment, blue = AI next-best-action
- **Steps** — the recommended play as a numbered sequence
- **Scorecard** — multi-signal **MEDDPICC** deal-health gauge + per-dimension bars (the 2026 enterprise standard)
- **Risks** — MEDDPICC coverage radar + flagged risks (proactive signal synthesis)
- **Stakeholders** — buying-committee view + talk-distribution (multithreading; Gartner: 6–10 stakeholders/deal)
- **Battlecards** — auto competitor intel (their angle / our counter)

### Optional: Claude enrichment

The deterministic engine always runs offline (instant, zero-dep). For sharper, fuller
extraction, tick **Use Claude** in the UI — the same grounded contract, two backends, tried
in order:

1. **`claude` CLI** — if the host has an authed Claude Code login, Slipstream shells out to it
   (auto-refreshing OAuth, **no API key or SDK needed**). Default model **haiku** (~90s);
   override with `SLIPSTREAM_CLI_MODEL`.
2. **API key + SDK** — set `ANTHROPIC_API_KEY` and `npm i @anthropic-ai/sdk` for the
   structured-outputs path (`SLIPSTREAM_MODEL`, default `claude-sonnet-4-6`).

If neither is available it silently falls back to the deterministic engine.

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

**Private (Tailscale-only) for now.** Runs under pm2 bound to the host's Tailscale IP
(`100.124.131.86:3210`) — not on the public interface. Reachable on the tailnet right now at
`http://100.124.131.86:3210/`; target hostname is **`https://studio.apit.fun/slipstream/`**
— a one-block add to the existing (already Tailscale-bound) studio vhost, no DNS/cert change
([`deploy/studio.apit.fun.conf`](deploy/studio.apit.fun.conf)).
Setup + how to go public later: [`deploy/DEPLOY.md`](deploy/DEPLOY.md).

```bash
pm2 start ecosystem.config.cjs && pm2 save
```

## License

MIT — see [`LICENSE`](LICENSE).
