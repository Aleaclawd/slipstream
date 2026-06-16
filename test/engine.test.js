// engine.test.js — node:test suite for the deterministic extraction engine
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { analyzeTranscript } from '../src/engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const transcriptPath = join(__dirname, '../samples/discovery-call.txt');
const transcriptText = readFileSync(transcriptPath, 'utf8');
const totalLines = transcriptText.split('\n').length;

// Run once — deterministic so safe to share across tests
const result = analyzeTranscript(transcriptText);

// Helper to flatten all evidence objects in the result for the line-range check
function allEvidence(r) {
  const evs = [];
  const push = (e) => { if (e) evs.push(e); };
  r.stakeholders.forEach((s) => push(s.evidence));
  r.pains.forEach((p) => push(p.evidence));
  r.requirements.forEach((req) => push(req.evidence));
  r.objections.forEach((o) => push(o.evidence));
  r.competitors.forEach((c) => push(c.evidence));
  r.actions.forEach((a) => push(a.evidence));
  r.demoPrep.forEach((d) => push(d.evidence));
  r.rfpRows.forEach((row) => push(row.evidence));
  return evs;
}

// ─── Stakeholder tests ────────────────────────────────────────────────────────

test('stakeholders include Dan', () => {
  const names = result.stakeholders.map((s) => s.name);
  assert.ok(names.includes('Dan'), `Expected Dan in ${JSON.stringify(names)}`);
});

test('stakeholders include Maria', () => {
  const names = result.stakeholders.map((s) => s.name);
  assert.ok(names.includes('Maria'), `Expected Maria in ${JSON.stringify(names)}`);
});

test('stakeholders include Raj', () => {
  const names = result.stakeholders.map((s) => s.name);
  assert.ok(names.includes('Raj'), `Expected Raj in ${JSON.stringify(names)}`);
});

// ─── Pain tests ───────────────────────────────────────────────────────────────

test('at least one high-severity pain mentioning reconciliation or manual', () => {
  const highPains = result.pains.filter((p) => p.severity === 'high');
  assert.ok(highPains.length > 0, 'No high-severity pains found');
  const relevant = highPains.some(
    (p) =>
      /reconcil|manual/i.test(p.text) ||
      /reconcil|manual/i.test(p.evidence?.quote ?? '')
  );
  assert.ok(
    relevant,
    `No high pain mentions reconciliation/manual. High pains: ${JSON.stringify(highPains.map((p) => p.text))}`
  );
});

// ─── Requirement tests ────────────────────────────────────────────────────────

test('security requirement with evidence mentioning SOC 2 or Okta', () => {
  const secReqs = result.requirements.filter((r) => r.category === 'security');
  assert.ok(secReqs.length > 0, 'No security requirements found');
  const relevant = secReqs.some(
    (r) =>
      /SOC 2|Okta/i.test(r.evidence?.quote ?? '') ||
      /SOC 2|Okta/i.test(r.text)
  );
  assert.ok(relevant, `No security req evidence mentions SOC 2 or Okta. Reqs: ${JSON.stringify(secReqs)}`);
});

test('integration requirement with evidence mentioning Snowflake', () => {
  const intReqs = result.requirements.filter((r) => r.category === 'integration');
  assert.ok(intReqs.length > 0, 'No integration requirements found');
  const relevant = intReqs.some(
    (r) =>
      /Snowflake/i.test(r.evidence?.quote ?? '') ||
      /Snowflake/i.test(r.text)
  );
  assert.ok(relevant, `No integration req mentions Snowflake. Reqs: ${JSON.stringify(intReqs)}`);
});

test('at least one scale requirement (50 million / within a minute / events)', () => {
  const scaleReqs = result.requirements.filter((r) => r.category === 'scale');
  assert.ok(scaleReqs.length > 0, 'No scale requirements found');
  const relevant = scaleReqs.some(
    (r) =>
      /50.?million|50M|within a minute|events/i.test(r.evidence?.quote ?? '') ||
      /50.?million|50M|within a minute|events/i.test(r.text)
  );
  assert.ok(relevant, `No scale req matches expected terms. Reqs: ${JSON.stringify(scaleReqs)}`);
});

// ─── Competitor tests ─────────────────────────────────────────────────────────

test('competitors include Gong and/or Kafka', () => {
  const compNames = result.competitors.map((c) => c.name);
  const hasGong = compNames.some((n) => /Gong/i.test(n));
  const hasKafka = compNames.some((n) => /Kafka/i.test(n));
  assert.ok(hasGong || hasKafka, `Expected Gong or Kafka in competitors: ${JSON.stringify(compNames)}`);
});

// ─── Actions tests ────────────────────────────────────────────────────────────

test('actions.length >= 3', () => {
  assert.ok(result.actions.length >= 3, `Only ${result.actions.length} actions found`);
});

// ─── Evidence line-range test ─────────────────────────────────────────────────

test('every non-null evidence.line is an integer between 1 and total transcript lines', () => {
  const evs = allEvidence(result);
  for (const ev of evs) {
    assert.ok(Number.isInteger(ev.line), `evidence.line is not an integer: ${ev.line}`);
    assert.ok(ev.line >= 1, `evidence.line < 1: ${ev.line}`);
    assert.ok(ev.line <= totalLines, `evidence.line ${ev.line} > total lines ${totalLines}`);
  }
});

// ─── Follow-up email tests ────────────────────────────────────────────────────

test('followupEmail.subject is non-empty', () => {
  assert.ok(
    typeof result.followupEmail.subject === 'string' && result.followupEmail.subject.length > 0,
    'followupEmail.subject is empty'
  );
});

test('followupEmail.body is non-empty', () => {
  assert.ok(
    typeof result.followupEmail.body === 'string' && result.followupEmail.body.length > 0,
    'followupEmail.body is empty'
  );
});

// ─── RFP rows tests ───────────────────────────────────────────────────────────

test('rfpRows has at least one row', () => {
  assert.ok(result.rfpRows.length >= 1, 'No rfpRows found');
});

test('any rfpRow with status verified has non-null evidence', () => {
  const verified = result.rfpRows.filter((r) => r.status === 'verified');
  for (const row of verified) {
    assert.ok(
      row.evidence !== null && row.evidence !== undefined,
      `Verified rfpRow has null evidence: ${JSON.stringify(row)}`
    );
  }
});
