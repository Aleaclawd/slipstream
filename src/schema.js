// Shared data contract for Slipstream.
//
// Every extractor (the deterministic engine in engine.js and the optional
// Claude enrichment in llm.js) MUST return an object matching ExtractionResult.
// The cardinal rule: every finding carries `evidence` pointing back at the
// transcript span it came from. No evidence -> it is "unverified", never asserted.

/**
 * @typedef {Object} Evidence
 * @property {string} quote   - verbatim text from the transcript
 * @property {number} line    - 1-based line number in the original transcript
 * @property {string|null} speaker - who said it, if known
 * @property {string|null} ts  - timestamp token if present (e.g. "00:12")
 */

/**
 * @typedef {Object} ExtractionResult
 * @property {{dealName:string, oneLiner:string}} summary
 * @property {Array<{name:string, role:string, evidence:Evidence|null}>} stakeholders
 * @property {Array<{text:string, severity:'high'|'med'|'low', evidence:Evidence|null}>} pains
 * @property {Array<{category:string, text:string, evidence:Evidence|null}>} requirements
 * @property {Array<{text:string, evidence:Evidence|null}>} objections
 * @property {Array<{name:string, evidence:Evidence|null}>} competitors
 * @property {Array<{title:string, owner:string, due:string, priority:'P1'|'P2'|'P3', evidence:Evidence|null}>} actions
 * @property {{subject:string, body:string}} followupEmail
 * @property {Array<{item:string, rationale:string, evidence:Evidence|null}>} demoPrep
 * @property {Array<{question:string, suggestedAnswer:string, status:'verified'|'unverified', evidence:Evidence|null}>} rfpRows
 * @property {Object<string,string>} crmFields
 */

export const REQUIREMENT_CATEGORIES = [
  'integration',
  'security',
  'scale',
  'feature',
  'commercial',
  'open_question',
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
  };
}

/**
 * Coerce any partial/loosely-typed object (e.g. an LLM response) into a
 * valid ExtractionResult. Defensive: never throws on missing fields.
 * @param {any} raw
 * @returns {ExtractionResult}
 */
export function normalizeResult(raw) {
  const base = emptyResult();
  if (!raw || typeof raw !== 'object') return base;
  const arr = (v) => (Array.isArray(v) ? v : []);
  const ev = (e) =>
    e && typeof e === 'object' && typeof e.quote === 'string'
      ? {
          quote: String(e.quote),
          line: Number.isFinite(e.line) ? e.line : 0,
          speaker: e.speaker ?? null,
          ts: e.ts ?? null,
        }
      : null;

  return {
    summary: {
      dealName: String(raw.summary?.dealName ?? base.summary.dealName),
      oneLiner: String(raw.summary?.oneLiner ?? base.summary.oneLiner),
    },
    stakeholders: arr(raw.stakeholders).map((s) => ({
      name: String(s.name ?? ''),
      role: String(s.role ?? ''),
      evidence: ev(s.evidence),
    })),
    pains: arr(raw.pains).map((p) => ({
      text: String(p.text ?? ''),
      severity: ['high', 'med', 'low'].includes(p.severity) ? p.severity : 'med',
      evidence: ev(p.evidence),
    })),
    requirements: arr(raw.requirements).map((r) => ({
      category: REQUIREMENT_CATEGORIES.includes(r.category) ? r.category : 'feature',
      text: String(r.text ?? ''),
      evidence: ev(r.evidence),
    })),
    objections: arr(raw.objections).map((o) => ({
      text: String(o.text ?? ''),
      evidence: ev(o.evidence),
    })),
    competitors: arr(raw.competitors).map((c) => ({
      name: String(c.name ?? ''),
      evidence: ev(c.evidence),
    })),
    actions: arr(raw.actions).map((a) => ({
      title: String(a.title ?? ''),
      owner: String(a.owner ?? 'SE'),
      due: String(a.due ?? ''),
      priority: ['P1', 'P2', 'P3'].includes(a.priority) ? a.priority : 'P2',
      evidence: ev(a.evidence),
    })),
    followupEmail: {
      subject: String(raw.followupEmail?.subject ?? ''),
      body: String(raw.followupEmail?.body ?? ''),
    },
    demoPrep: arr(raw.demoPrep).map((d) => ({
      item: String(d.item ?? ''),
      rationale: String(d.rationale ?? ''),
      evidence: ev(d.evidence),
    })),
    rfpRows: arr(raw.rfpRows).map((r) => ({
      question: String(r.question ?? ''),
      suggestedAnswer: String(r.suggestedAnswer ?? ''),
      status: r.status === 'verified' ? 'verified' : 'unverified',
      evidence: ev(r.evidence),
    })),
    crmFields:
      raw.crmFields && typeof raw.crmFields === 'object' ? raw.crmFields : {},
  };
}

/**
 * JSON Schema handed to Claude for structured output (output_config.format).
 * Mirrors ExtractionResult minus the runtime-only `meta` wrapper.
 */
export const EXTRACTION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: {
      type: 'object',
      additionalProperties: false,
      properties: {
        dealName: { type: 'string' },
        oneLiner: { type: 'string' },
      },
      required: ['dealName', 'oneLiner'],
    },
    stakeholders: { type: 'array', items: refWith({ name: 'string', role: 'string' }) },
    pains: {
      type: 'array',
      items: refWith({ text: 'string', severity: { type: 'string', enum: ['high', 'med', 'low'] } }),
    },
    requirements: {
      type: 'array',
      items: refWith({
        category: { type: 'string', enum: REQUIREMENT_CATEGORIES },
        text: 'string',
      }),
    },
    objections: { type: 'array', items: refWith({ text: 'string' }) },
    competitors: { type: 'array', items: refWith({ name: 'string' }) },
    actions: {
      type: 'array',
      items: refWith({
        title: 'string',
        owner: 'string',
        due: 'string',
        priority: { type: 'string', enum: ['P1', 'P2', 'P3'] },
      }),
    },
    followupEmail: {
      type: 'object',
      additionalProperties: false,
      properties: { subject: { type: 'string' }, body: { type: 'string' } },
      required: ['subject', 'body'],
    },
    demoPrep: { type: 'array', items: refWith({ item: 'string', rationale: 'string' }) },
    rfpRows: {
      type: 'array',
      items: refWith({
        question: 'string',
        suggestedAnswer: 'string',
        status: { type: 'string', enum: ['verified', 'unverified'] },
      }),
    },
    crmFields: { type: 'object', additionalProperties: { type: 'string' } },
  },
  required: [
    'summary', 'stakeholders', 'pains', 'requirements', 'objections',
    'competitors', 'actions', 'followupEmail', 'demoPrep', 'rfpRows', 'crmFields',
  ],
};

// Helper: build an object schema whose props are the given fields plus a
// nullable `evidence` block (quote/line/speaker/ts).
function refWith(fields) {
  const props = {};
  for (const [k, v] of Object.entries(fields)) {
    props[k] = typeof v === 'string' ? { type: v } : v;
  }
  props.evidence = {
    anyOf: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          quote: { type: 'string' },
          line: { type: 'integer' },
          speaker: { type: ['string', 'null'] },
          ts: { type: ['string', 'null'] },
        },
        required: ['quote', 'line'],
      },
      { type: 'null' },
    ],
  };
  return {
    type: 'object',
    additionalProperties: false,
    properties: props,
    required: [...Object.keys(fields), 'evidence'],
  };
}
