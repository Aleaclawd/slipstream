// generalization.test.js — the deterministic engine must GENERALIZE: run it on a second,
// unrelated transcript and prove it (a) stays grounded and (b) never leaks or fabricates the
// first sample's specifics. This is the regression guard for the CEO review finding that the
// engine had been demo-tuned to sample #1 (and would fabricate on any other input).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { analyzeTranscript } from '../src/engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const text = readFileSync(join(__dirname, '../samples/discovery-call-2.txt'), 'utf8');
const lines = text.split('\n');
const result = analyzeTranscript(text);
const blob = JSON.stringify(result);

// Tokens that exist ONLY in sample #1 — and NOT in sample #2. If any of these appears in the
// sample-#2 output, the engine fabricated it from the demo instead of reading the actual call.
const SAMPLE1_ONLY = [
  'Priya', 'Dan', 'Maria', 'Raj', 'Lena', 'Acme', 'Northwind',
  'Snowflake', 'Slack', 'Okta', 'SOC 2', 'Gong', 'Kafka',
  'shipment', '50 million', '50M',
];

test('sample #2 output contains no sample #1 specifics (no demo overfit / fabrication)', () => {
  // Guard the premise: none of these tokens are actually present in transcript #2.
  for (const tok of SAMPLE1_ONLY) {
    assert.ok(!text.includes(tok), `test setup error: "${tok}" unexpectedly in sample #2 transcript`);
  }
  const leaked = SAMPLE1_ONLY.filter((tok) => blob.includes(tok));
  assert.deepEqual(leaked, [], `Engine leaked sample-#1 specifics into sample-#2 output: ${leaked.join(', ')}`);
});

test('every finding is grounded: evidence.quote is the verbatim transcript line at evidence.line', () => {
  const evs = [];
  const push = (e) => { if (e) evs.push(e); };
  result.stakeholders.forEach((s) => push(s.evidence));
  result.pains.forEach((p) => push(p.evidence));
  result.requirements.forEach((r) => push(r.evidence));
  result.objections.forEach((o) => push(o.evidence));
  result.competitors.forEach((c) => push(c.evidence));
  result.actions.forEach((a) => push(a.evidence));
  result.demoPrep.forEach((d) => push(d.evidence));
  result.rfpRows.forEach((r) => push(r.evidence));
  result.dealHealth.dimensions.forEach((d) => push(d.evidence));
  assert.ok(evs.length > 0, 'no evidence produced');
  for (const ev of evs) {
    assert.ok(Number.isInteger(ev.line) && ev.line >= 1 && ev.line <= lines.length, `bad evidence.line ${ev.line}`);
    assert.equal(lines[ev.line - 1].trim(), ev.quote, `evidence.quote is not the verbatim line ${ev.line}`);
  }
});

test('RFP answers never assert an unverified capability (only transcript-confirmed ones)', () => {
  const FABRICATION = /SOC 2 Type II certified|EU-region data residency available|native Snowflake connector|P99 alert latency/i;
  for (const row of result.rfpRows) {
    if (row.status !== 'verified') {
      assert.match(row.suggestedAnswer, /draft/i, `unverified RFP answer is not a neutral draft: ${row.suggestedAnswer}`);
    }
    assert.doesNotMatch(row.suggestedAnswer, FABRICATION, `RFP answer fabricates a capability: ${row.suggestedAnswer}`);
  }
});

test('follow-up email is signed with the detected SE, cites lines, and names THIS prospect', () => {
  const { subject, body } = result.followupEmail;
  assert.match(body, /^Sam\s*$/m, 'email is not signed by the detected SE (Sam)');
  assert.doesNotMatch(body, /Priya/, 'email leaked the sample-#1 SE name');
  assert.match(body, /line \d+:/, 'email has no transcript line citations');
  assert.match(subject, /Cendora/, 'subject does not name this prospect');
});

test('rich intelligence is produced for an unseen transcript', () => {
  assert.ok(result.stakeholders.length >= 2, 'too few stakeholders');
  assert.ok(result.pains.some((p) => p.severity === 'high'), 'no high-severity pain');
  for (const cat of ['security', 'integration', 'scale']) {
    assert.ok(result.requirements.some((r) => r.category === cat), `no ${cat} requirement extracted`);
  }
  assert.ok(result.actions.length >= 3, 'too few actions');
  assert.ok(result.dealHealth.score >= 0 && result.dealHealth.score <= 100, 'dealHealth.score out of range');
  assert.equal(result.dealHealth.dimensions.length, 8, 'expected 8 MEDDPICC dimensions');
  assert.ok(result.nextBestActions.length >= 1, 'no next-best-actions');
  assert.ok(result.analytics.speakers.length >= 2, 'analytics missing speakers');
  // economic buyer is named in the call ("CFO, Marcus") — must be picked up, not invented.
  assert.match(JSON.stringify(result.crmFields), /Marcus/, 'economic buyer not extracted');
});
