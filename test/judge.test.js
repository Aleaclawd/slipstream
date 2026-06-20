// judge.test.js — pass-2 ⑤ LLM-judge layer. Deterministic via an injected judge (the real
// Claude-CLI judge is exercised by a separate live smoke, not in the unit suite).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeVerifiedRfpRows } from '../src/judge.js';

const mkResult = (status) => ({
  rfpRows: [{ question: 'Integration — Snowflake?', suggestedAnswer: 'Confirmed on the call: "…"', status, evidence: { quote: 'x', line: 1 } }],
});

test('downgrades a verified row when the judge returns confirmed:false', async () => {
  const r = await judgeVerifiedRfpRows(mkResult('verified'), 't', { judge: async () => ({ confirmed: false, reason: 'roadmap only, not present' }) });
  assert.equal(r.rfpRows[0].status, 'unverified');
  assert.match(r.rfpRows[0].judgeNote, /roadmap/);
});

test('keeps a verified row when the judge returns confirmed:true', async () => {
  const r = await judgeVerifiedRfpRows(mkResult('verified'), 't', { judge: async () => ({ confirmed: true, reason: '' }) });
  assert.equal(r.rfpRows[0].status, 'verified');
});

test('never judges an already-unverified row (no false strengthening)', async () => {
  let called = false;
  const r = await judgeVerifiedRfpRows(mkResult('unverified'), 't', { judge: async () => { called = true; return { confirmed: false }; } });
  assert.equal(r.rfpRows[0].status, 'unverified');
  assert.equal(called, false);
});

test('degrades gracefully — a thrown judge leaves the deterministic verdict intact', async () => {
  const r = await judgeVerifiedRfpRows(mkResult('verified'), 't', { judge: async () => { throw new Error('llm down'); } });
  assert.equal(r.rfpRows[0].status, 'verified');
});
