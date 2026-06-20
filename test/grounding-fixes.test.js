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

// ─── ① Grounding — retraction / conditional (verify-skeptic refutations, loop 2) ──────────

test('a negation in an ADJACENT sentence blocks verification (no cross-sentence laundering)', () => {
  const t = [
    'Maria (Security Lead, Northwind): We need SSO via Okta and EU data residency.',
    'Priya (Sales Engineer, Acme): EU residency and Okta SSO are supported on our roadmap. They are not available today.',
  ].join('\n');
  const sec = analyzeTranscript(t).rfpRows.find((row) => /security/i.test(row.question));
  assert.equal(sec.status, 'unverified', 'a roadmap / not-available capability must not be verified');
});

test('a contract-conditional capability is not verified', () => {
  const t = [
    'Maria (Security Lead, Northwind): We need SSO via Okta and EU data residency.',
    'Priya (Sales Engineer, Acme): We can support EU residency and Okta SSO once the contract is signed.',
  ].join('\n');
  const sec = analyzeTranscript(t).rfpRows.find((row) => /security/i.test(row.question));
  assert.equal(sec.status, 'unverified', 'a contract-conditional is not a present confirmation');
});

test('a later SE utterance retracting a capability blocks an earlier confirmation', () => {
  const t = [
    'Maria (Security Lead, Northwind): We need EU data residency.',
    'Priya (Sales Engineer, Acme): EU residency is supported.',
    'Priya (Sales Engineer, Acme): Actually, correction — EU residency is not supported in your region.',
  ].join('\n');
  const sec = analyzeTranscript(t).rfpRows.find((row) => /security/i.test(row.question));
  assert.equal(sec.status, 'unverified', 'a later retraction must contest the category');
});

// ─── ② Attribution — multi-seller-rep Account (verify-skeptic refutation, loop 2) ─────────

test('Account is the prospect org even with two seller-side reps from the same vendor', () => {
  const t = [
    'Priya (Sales Engineer, Acme): Thanks for the time.',
    'Jordan (Account Executive, Acme): Glad we could connect.',
    'Dan (VP Engineering, Northwind): We reconcile shipment events by hand and it is killing us.',
  ].join('\n');
  assert.equal(analyzeTranscript(t).crmFields.Account, 'Northwind', 'a second seller rep must not flip the Account to the seller org');
});

// ─── loop 3: close verify-skeptic round-2 counterexamples (synonyms / spellings / fuzzy) ───
// NOTE: the retraction allowlist is necessarily non-exhaustive (see commit message / report) —
// these lock the specific phrasings the skeptic found, not a proof of universal coverage.

test('roadmap/conditional synonyms (pending, next release, no … yet) stay unverified', () => {
  const M = 'Maria (Security Lead, Northwind): we need SSO via Okta and EU data residency\n';
  for (const seLine of [
    'Priya (Sales Engineer, Acme): EU residency is supported, pending certification.',
    'Priya (Sales Engineer, Acme): EU residency is supported in our next release.',
    'Priya (Sales Engineer, Acme): EU residency is supported. There is no Okta SSO yet.',
  ]) {
    const sec = analyzeTranscript(M + seLine).rfpRows.find((r) => /security/i.test(r.question));
    assert.equal(sec.status, 'unverified', `should stay unverified for: ${seLine}`);
  }
});

test('Account survives same-vendor org-spelling variants (Acme vs Acme Inc)', () => {
  const t = [
    'Priya (Sales Engineer, Acme): hi',
    'Jordan (Account Executive, Acme Inc): hi',
    'Dan (VP Engineering, Northwind): reconciling shipment events by hand is killing us',
  ].join('\n');
  assert.equal(analyzeTranscript(t).crmFields.Account, 'Northwind');
});

// ─── loop 4: the canonical POSITIVE path must verify (verify-skeptic, the real value path) ───

test('short-acronym confirmations DO verify (Okta SSO, SOC 2, SAML, REST API, webhooks)', () => {
  const sec = (req, se) =>
    analyzeTranscript(`Maria (Security Lead, Northwind): ${req}\nPriya (Sales Engineer, Acme): ${se}`)
      .rfpRows.find((r) => /security/i.test(r.question)).status;
  const intg = (req, se) =>
    analyzeTranscript(`Dan (VP Engineering, Northwind): ${req}\nPriya (Sales Engineer, Acme): ${se}`)
      .rfpRows.find((r) => /integration/i.test(r.question)).status;
  // These all share the IDENTICAL keyword with the requirement — a <=4-char acronym the old
  // length>4 filter dropped, silently failing the engine's primary value path.
  assert.equal(sec('we need SSO via Okta', 'Okta SSO is supported.'), 'verified');
  assert.equal(sec('we need SOC 2 compliance', 'We are SOC 2 compliant.'), 'verified');
  assert.equal(sec('we need SAML SSO', 'SAML SSO is supported.'), 'verified');
  assert.equal(intg('we need a REST API to integrate', 'We have a REST API.'), 'verified');
  assert.equal(intg('we need webhooks to integrate', 'Webhooks are supported.'), 'verified');
});

test('capability-verb confirmations DO verify ("we integrate", "it writes back")', () => {
  const intg = (req, se) =>
    analyzeTranscript(`Dan (VP Engineering, Northwind): ${req}\nPriya (Sales Engineer, Acme): ${se}`)
      .rfpRows.find((r) => /integration/i.test(r.question)).status;
  // affirmative present-tense capability stated with an ACTION VERB, not "supported"
  assert.equal(intg('we need to integrate with Snowflake', 'We integrate with Snowflake natively.'), 'verified');
  assert.equal(intg('we need Snowflake write-back', 'It writes back to Snowflake.'), 'verified');
  // but the conditional form of the same verb must NOT verify
  assert.equal(intg('we need to integrate with Snowflake', 'We integrate with Snowflake once the contract is signed.'), 'unverified');
});

test('S12: a partial-token-overlap quote is NOT accepted as grounded (no fuzzy hole)', () => {
  const out = verifyEvidenceGrounding(
    { rfpRows: [{ question: 'q', suggestedAnswer: 'a', status: 'verified', evidence: { quote: 'EU residency Okta totally fabricated nonsense', line: 1 } }] },
    'EU residency and Okta SSO are supported',
  );
  assert.equal(out.rfpRows[0].status, 'unverified', 'partial-overlap citation must not keep verified');
});
