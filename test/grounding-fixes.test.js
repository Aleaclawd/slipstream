// grounding-fixes.test.js — held-out regression tests for the 2026-06-20 grounding/attribution/
// parser fixes (skeptic survivors ①②③). Each uses a NEW transcript (not the shipped samples)
// in real-world export formats, so the fixes can't be sample-overfit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTranscript } from '../src/engine.js';
import { verifyEvidenceGrounding } from '../src/schema.js';

// ─── ③ Parser robustness (S19/S23/S28/S15) ───────────────────────────────────

test('parser handles the default no-timestamp "Name (Role, Org):" export (was zero stakeholders)', () => {
  const t = [
    'Priya (Sales Engineer, Acme): Thanks for the time. What does your stack look like?',
    'Dan (VP Engineering, Northwind): We reconcile shipment events by hand and it is killing us.',
    'Maria (Security Lead, Northwind): We need SSO via Okta and EU data residency.',
  ].join('\n');
  const r = analyzeTranscript(t);
  const names = r.stakeholders.map((s) => s.name);
  assert.ok(names.includes('Dan') && names.includes('Maria'), `stakeholders: ${JSON.stringify(names)}`);
  assert.ok(r.stakeholders.every((s) => s.evidence && s.evidence.line >= 1));
});

test('parser handles H:MM:SS timestamps and "Speaker N:" / lowercase speaker labels', () => {
  const t = [
    '[1:02:03] Sam (Solutions Engineer, Slipstream): What hurts most today?',
    'Speaker 2: We need SAML SSO — that is a hard requirement.',
    'dan: we also need it to integrate with Snowflake.',
  ].join('\n');
  const r = analyzeTranscript(t);
  const speakers = r.analytics.speakers.map((s) => s.name);
  assert.ok(speakers.includes('Speaker 2'), `speakers: ${JSON.stringify(speakers)}`);
  assert.ok(speakers.includes('dan'));
  // and a section header must NOT become a phantom speaker
  const r2 = analyzeTranscript('Action Items:\nDan: we need SSO');
  assert.ok(!r2.analytics.speakers.some((s) => /action items/i.test(s.name)));
});

// ─── ② Attribution (S6/S13, S18, S25) ─────────────────────────────────────────

test('a prospect "I\'ll send…" commitment is owned by the prospect, not the SE (S6/S13)', () => {
  const t = [
    'Priya (Sales Engineer, Acme): Thanks for the time today.',
    "Dan (VP Engineering, Northwind): I'll send you our data dictionary and confirm the security contact by Friday.",
  ].join('\n');
  const r = analyzeTranscript(t);
  const danAction = r.actions.find((a) => /data dictionary|security contact/i.test(a.title));
  assert.ok(danAction, 'expected the prospect commitment to be captured as an action');
  assert.equal(danAction.owner, 'Prospect', 'prospect commitment must not be owned by SE');
});

test('SE detection recognizes the canonical titles Sales Engineer / Account Executive (S18)', () => {
  const t = [
    'Jordan (Account Executive, Acme): Appreciate the time.',
    "Rosa (Director of RevOps, Cendora): We're ISO 27001 and need SAML SSO.",
  ].join('\n');
  const r = analyzeTranscript(t);
  // The AE is the seller, so the prospect Account must be Cendora — not the seller's org.
  assert.equal(r.crmFields.Account, 'Cendora');
  // and the AE's own line is not mined as a prospect requirement.
  assert.ok(!r.requirements.some((req) => /appreciate the time/i.test(req.text)));
});

// ─── ① Grounding contract (S1/S5/S22) ─────────────────────────────────────────

test('a deferred SE promise ("I\'ll confirm…") never produces a verified RFP row (S1/S5)', () => {
  const t = [
    'Priya (Sales Engineer, Acme): Hi.',
    'Raj (Data Eng, Northwind): We do 50 million events a day and need alerts within a minute.',
    "Priya (Sales Engineer, Acme): Great question, I'll confirm the exact throughput numbers and get you a reference architecture.",
  ].join('\n');
  const r = analyzeTranscript(t);
  const scaleRow = r.rfpRows.find((row) => /scale/i.test(row.question));
  assert.ok(scaleRow, 'expected a scale RFP row');
  assert.equal(scaleRow.status, 'unverified', 'a future promise must not verify the requirement');
});

test('an affirmative same-category SE confirmation DOES verify (and only its own category) (S22)', () => {
  const t = [
    'Priya (Sales Engineer, Acme): Hi.',
    'Maria (Security Lead, Northwind): We need SSO via Okta and EU data residency.',
    'Dan (VP Engineering, Northwind): We also need to integrate with Snowflake and write back.',
    'Priya (Sales Engineer, Acme): EU residency and Okta SSO are both supported.',
  ].join('\n');
  const r = analyzeTranscript(t);
  const sec = r.rfpRows.find((row) => /security/i.test(row.question));
  const intg = r.rfpRows.find((row) => /integration/i.test(row.question));
  assert.equal(sec.status, 'verified', 'a real same-category confirmation should verify security');
  assert.equal(intg.status, 'unverified', 'a security confirmation must NOT launder an integration row');
});

// ─── ① Grounding contract — LLM path (S12) ────────────────────────────────────

test('verifyEvidenceGrounding nulls hallucinated citations and downgrades forged verified rows (S12)', () => {
  const transcript = 'Dan: we need SSO via Okta\nPriya (SE, Acme): SSO is supported';
  const out = verifyEvidenceGrounding(
    {
      actions: [{ title: 'x', owner: 'SE', due: '', priority: 'P2', evidence: { quote: 'a quote that appears nowhere', line: 99 } }],
      rfpRows: [{ question: 'q', suggestedAnswer: 'a', status: 'verified', evidence: { quote: 'fabricated', line: 2 } }],
    },
    transcript,
  );
  assert.equal(out.actions[0].evidence, null, 'out-of-range / non-matching citation must be nulled');
  assert.equal(out.rfpRows[0].status, 'unverified', 'forged verified row must be downgraded');
  // a genuine citation survives
  const ok = verifyEvidenceGrounding(
    { pains: [{ text: 'p', severity: 'high', evidence: { quote: 'SSO is supported', line: 2 } }] },
    transcript,
  );
  assert.ok(ok.pains[0].evidence, 'a real citation must be preserved');
});
