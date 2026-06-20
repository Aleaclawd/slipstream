// Shared data contract for Slipstream.
//
// Every extractor (the deterministic engine in engine.js and the optional Claude
// enrichment in llm.js) MUST return an object matching ExtractionResult. Cardinal
// rule: every finding carries `evidence` pointing back at the transcript span it
// came from. No evidence -> "unverified", never asserted.

/**
 * @typedef {Object} Evidence
 * @property {string} quote
 * @property {number} line
 * @property {string|null} speaker
 * @property {string|null} ts
 */

export const REQUIREMENT_CATEGORIES = [
  'integration', 'security', 'scale', 'feature', 'commercial', 'open_question',
];

// MEDDPICC — the 2026 enterprise-standard qualification methodology (adds
// Competition + Paper Process to MEDDIC). Drives the deal-health scorecard.
export const MEDDPICC_DIMENSIONS = [
  { key: 'metrics', label: 'Metrics' },
  { key: 'economic_buyer', label: 'Economic Buyer' },
  { key: 'decision_criteria', label: 'Decision Criteria' },
  { key: 'decision_process', label: 'Decision Process' },
  { key: 'paper_process', label: 'Paper Process' },
  { key: 'identified_pain', label: 'Identified Pain' },
  { key: 'champion', label: 'Champion' },
  { key: 'competition', label: 'Competition' },
];

/** A guaranteed-shaped empty result; extractors fill it in. */
export function emptyResult() {
  return {
    summary: { dealName: '', oneLiner: '' },
    stakeholders: [],
    pains: [],
    requirements: [],
    objections: [],
    competitors: [],
    actions: [],
    followupEmail: { subject: '', body: '' },
    demoPrep: [],
    rfpRows: [],
    crmFields: {},
    // --- MVP feature fields (2026-trend-grounded) ---
    dealHealth: { score: 0, dimensions: [] }, // multi-signal MEDDPICC scorecard
    risks: [], // proactive risk signals
    nextBestActions: [], // agentic AI recommendations
    battlecards: [], // competitor intel
    analytics: { speakers: [], note: '' }, // conversation analytics (talk distribution)
  };
}

const arr = (v) => (Array.isArray(v) ? v : []);
const int = (v, d = 0) => (Number.isFinite(v) ? Math.round(v) : d);
const ev = (e) =>
  e && typeof e === 'object' && typeof e.quote === 'string'
    ? { quote: String(e.quote), line: Number.isFinite(e.line) ? e.line : 0, speaker: e.speaker ?? null, ts: e.ts ?? null }
    : null;
const sev = (s) => (['high', 'med', 'low'].includes(s) ? s : 'med');
const pri = (p) => (['P1', 'P2', 'P3'].includes(p) ? p : 'P2');

/** Coerce any partial/loose object (e.g. an LLM response) into a valid ExtractionResult. */
export function normalizeResult(raw) {
  const base = emptyResult();
  if (!raw || typeof raw !== 'object') return base;

  const result = {
    summary: {
      dealName: String(raw.summary?.dealName ?? ''),
      oneLiner: String(raw.summary?.oneLiner ?? ''),
    },
    stakeholders: arr(raw.stakeholders).map((s) => ({ name: String(s.name ?? ''), role: String(s.role ?? ''), evidence: ev(s.evidence) })),
    pains: arr(raw.pains).map((p) => ({ text: String(p.text ?? ''), severity: sev(p.severity), evidence: ev(p.evidence) })),
    requirements: arr(raw.requirements).map((r) => ({
      category: REQUIREMENT_CATEGORIES.includes(r.category) ? r.category : 'feature',
      text: String(r.text ?? ''), evidence: ev(r.evidence),
    })),
    objections: arr(raw.objections).map((o) => ({ text: String(o.text ?? ''), evidence: ev(o.evidence) })),
    competitors: arr(raw.competitors).map((c) => ({ name: String(c.name ?? ''), evidence: ev(c.evidence) })),
    actions: arr(raw.actions).map((a) => ({
      title: String(a.title ?? ''), owner: String(a.owner ?? 'SE'), due: String(a.due ?? ''), priority: pri(a.priority), evidence: ev(a.evidence),
    })),
    followupEmail: { subject: String(raw.followupEmail?.subject ?? ''), body: String(raw.followupEmail?.body ?? '') },
    demoPrep: arr(raw.demoPrep).map((d) => ({ item: String(d.item ?? ''), rationale: String(d.rationale ?? ''), evidence: ev(d.evidence) })),
    rfpRows: arr(raw.rfpRows).map((r) => ({
      question: String(r.question ?? ''), suggestedAnswer: String(r.suggestedAnswer ?? ''),
      status: r.status === 'verified' ? 'verified' : 'unverified', evidence: ev(r.evidence),
    })),
    crmFields: raw.crmFields && typeof raw.crmFields === 'object' ? raw.crmFields : {},

    dealHealth: {
      score: Math.max(0, Math.min(100, int(raw.dealHealth?.score))),
      dimensions: arr(raw.dealHealth?.dimensions).map((d) => ({
        key: String(d.key ?? ''),
        label: String(d.label ?? d.key ?? ''),
        score: Math.max(0, Math.min(100, int(d.score))),
        note: String(d.note ?? ''),
        evidence: ev(d.evidence),
      })),
    },
    risks: arr(raw.risks).map((r) => ({ text: String(r.text ?? ''), severity: sev(r.severity), evidence: ev(r.evidence) })),
    nextBestActions: arr(raw.nextBestActions).map((n) => ({
      action: String(n.action ?? ''), rationale: String(n.rationale ?? ''), priority: pri(n.priority), evidence: ev(n.evidence),
    })),
    battlecards: arr(raw.battlecards).map((b) => ({
      competitor: String(b.competitor ?? ''), theirAngle: String(b.theirAngle ?? ''), ourCounter: String(b.ourCounter ?? ''), evidence: ev(b.evidence),
    })),
    analytics: {
      speakers: arr(raw.analytics?.speakers).map((s) => ({ name: String(s.name ?? ''), role: String(s.role ?? ''), turns: int(s.turns) })),
      note: String(raw.analytics?.note ?? ''),
    },
  };
  return result;
}

/**
 * Enforce the grounding contract on an extraction result against the source transcript.
 * The LLM path (llm.js) otherwise trusts model-returned `evidence` verbatim — a hallucinated
 * quote at a non-existent line would ship as fact (S12). Here, any finding whose cited line is
 * out of range or whose quote doesn't actually appear at that line loses its evidence (becomes
 * ungrounded), and a 'verified' RFP row with a bad citation is downgraded to 'unverified'.
 * No-op for the deterministic engine, whose evidence is grounded by construction.
 */
export function verifyEvidenceGrounding(result, transcript) {
  if (!result || typeof result !== 'object') return result;
  const lines = String(transcript ?? '').split('\n');
  const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
  const lineText = (n) => (Number.isInteger(n) && n >= 1 && n <= lines.length ? norm(lines[n - 1]) : '');
  const grounded = (e) => {
    if (!e || !Number.isFinite(e.line)) return false;
    const lt = lineText(e.line);
    const q = norm(e.quote);
    if (!lt || !q) return false;
    if (lt.includes(q) || q.includes(lt)) return true;
    // Clipped spans: require >=60% of the quote's significant tokens to appear at the cited line.
    const qt = q.split(' ').filter((w) => w.length > 3);
    if (!qt.length) return false;
    return qt.filter((w) => lt.includes(w)).length / qt.length >= 0.6;
  };
  const scrub = (xs) => arr(xs).forEach((f) => { if (f && !grounded(f.evidence)) f.evidence = null; });
  scrub(result.stakeholders); scrub(result.pains); scrub(result.requirements);
  scrub(result.objections); scrub(result.competitors); scrub(result.actions);
  scrub(result.demoPrep); scrub(result.risks); scrub(result.nextBestActions); scrub(result.battlecards);
  arr(result.dealHealth?.dimensions).forEach((d) => { if (d && !grounded(d.evidence)) d.evidence = null; });
  arr(result.rfpRows).forEach((row) => {
    if (row && !grounded(row.evidence)) { row.evidence = null; if (row.status === 'verified') row.status = 'unverified'; }
  });
  return result;
}

// --- JSON Schema for Claude structured output / prompt documentation ---
function refWith(fields, required) {
  const props = {};
  for (const [k, v] of Object.entries(fields)) props[k] = typeof v === 'string' ? { type: v } : v;
  props.evidence = {
    anyOf: [
      { type: 'object', additionalProperties: false,
        properties: { quote: { type: 'string' }, line: { type: 'integer' }, speaker: { type: ['string', 'null'] }, ts: { type: ['string', 'null'] } },
        required: ['quote', 'line'] },
      { type: 'null' },
    ],
  };
  return { type: 'object', additionalProperties: false, properties: props, required: [...(required ?? Object.keys(fields)), 'evidence'] };
}

export const EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'object', additionalProperties: false, properties: { dealName: { type: 'string' }, oneLiner: { type: 'string' } }, required: ['dealName', 'oneLiner'] },
    stakeholders: { type: 'array', items: refWith({ name: 'string', role: 'string' }) },
    pains: { type: 'array', items: refWith({ text: 'string', severity: { type: 'string', enum: ['high', 'med', 'low'] } }) },
    requirements: { type: 'array', items: refWith({ category: { type: 'string', enum: REQUIREMENT_CATEGORIES }, text: 'string' }) },
    objections: { type: 'array', items: refWith({ text: 'string' }) },
    competitors: { type: 'array', items: refWith({ name: 'string' }) },
    actions: { type: 'array', items: refWith({ title: 'string', owner: 'string', due: 'string', priority: { type: 'string', enum: ['P1', 'P2', 'P3'] } }) },
    followupEmail: { type: 'object', additionalProperties: false, properties: { subject: { type: 'string' }, body: { type: 'string' } }, required: ['subject', 'body'] },
    demoPrep: { type: 'array', items: refWith({ item: 'string', rationale: 'string' }) },
    rfpRows: { type: 'array', items: refWith({ question: 'string', suggestedAnswer: 'string', status: { type: 'string', enum: ['verified', 'unverified'] } }) },
    crmFields: { type: 'object', additionalProperties: { type: 'string' } },
    dealHealth: {
      type: 'object', additionalProperties: false,
      properties: {
        score: { type: 'integer' },
        dimensions: { type: 'array', items: refWith({ key: 'string', label: 'string', score: { type: 'integer' }, note: 'string' }) },
      },
      required: ['score', 'dimensions'],
    },
    risks: { type: 'array', items: refWith({ text: 'string', severity: { type: 'string', enum: ['high', 'med', 'low'] } }) },
    nextBestActions: { type: 'array', items: refWith({ action: 'string', rationale: 'string', priority: { type: 'string', enum: ['P1', 'P2', 'P3'] } }) },
    battlecards: { type: 'array', items: refWith({ competitor: 'string', theirAngle: 'string', ourCounter: 'string' }) },
    analytics: {
      type: 'object', additionalProperties: false,
      properties: { speakers: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string' }, role: { type: 'string' }, turns: { type: 'integer' } }, required: ['name', 'role', 'turns'] } }, note: { type: 'string' } },
      required: ['speakers', 'note'],
    },
  },
  required: [
    'summary', 'stakeholders', 'pains', 'requirements', 'objections', 'competitors',
    'actions', 'followupEmail', 'demoPrep', 'rfpRows', 'crmFields',
    'dealHealth', 'risks', 'nextBestActions', 'battlecards', 'analytics',
  ],
};
