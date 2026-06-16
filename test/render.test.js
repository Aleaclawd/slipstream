// Render test — runs every UI renderer on real engine output in Node (with a tiny DOM
// shim so the browser module imports), catching exceptions and bad-data leakage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));

// Minimal DOM/fetch shim so importing app.js (a browser ES module) doesn't throw at load.
const el = () => ({
  addEventListener() {}, appendChild() {}, querySelector() { return null; }, querySelectorAll() { return []; },
  classList: { toggle() {}, add() {}, remove() {} }, dataset: {}, textContent: '',
  set innerHTML(_) {}, get innerHTML() { return ''; }, set hidden(_) {}, get hidden() { return true; },
});
globalThis.document = { getElementById: () => el(), querySelectorAll: () => [], addEventListener() {} };
globalThis.fetch = async () => ({ ok: true, json: async () => ({ llm: false, model: 'x' }), text: async () => '', blob: async () => ({}) });

const { analyzeTranscript } = await import('../src/engine.js');
const app = await import('../web/app.js');
const result = analyzeTranscript(readFileSync(join(dir, '../samples/discovery-call.txt'), 'utf8'));

test('every UI renderer returns clean HTML on real engine output', () => {
  const checks = {
    renderBrief: ['Pains', 'Follow-up email', 'CRM-ready'],
    renderScorecard: ['MEDDPICC', '<svg'],
    renderRisks: ['<svg', 'Risks'],
    renderSteps: ['step', 'Recommended play'],
    renderKanban: ['kcard', 'Now'],
    renderStakeholders: ['committee', 'Talk distribution'],
    renderBattlecards: ['Gong'],
  };
  for (const [fn, subs] of Object.entries(checks)) {
    const html = app[fn](result);
    assert.equal(typeof html, 'string', `${fn} returns a string`);
    assert.ok(html.length > 20, `${fn} non-empty`);
    for (const s of subs) assert.ok(html.includes(s), `${fn} includes "${s}"`);
    assert.ok(!html.includes('[object Object]'), `${fn} no object leakage`);
    assert.ok(!html.includes('undefined</'), `${fn} no undefined leakage`);
  }
});
