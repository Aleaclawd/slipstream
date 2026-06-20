// recall-fixes.test.js — pass-2 ④ recall: due-dates, scale numbers, multi-clause action splits
// (skeptic survivors S3/S8/S14, S7, S4/S20). Bounded to these enumerated, committed cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTranscript } from '../src/engine.js';

const SE = 'Priya (Sales Engineer, Acme): Thanks for the time.';
const seAction = (line) =>
  analyzeTranscript(`${SE}\nDan (VP Engineering, Northwind): we need a POC\nPriya (Sales Engineer, Acme): ${line}`)
    .actions.find((a) => a.owner === 'SE');

test('due-dates: relative + absolute phrasings are captured (S3/S8/S14)', () => {
  assert.equal(seAction("I'll send the POC plan in three weeks.").due, 'in three weeks');
  assert.equal(seAction("I'll confirm the write-back by Friday.").due, 'by Friday');
  assert.equal(seAction("I'll deliver the security pack within 30 days.").due, 'within 30 days');
  assert.match(seAction("I'll get you the report by end of Q3.").due, /end of Q3/i);
});

test('scale requirements with explicit numbers are captured (S7)', () => {
  const r = analyzeTranscript(`${SE}\nRaj (Data Eng, Northwind): we do 120k requests per second and spikes to 2M rows on close.`);
  const scale = r.requirements.filter((x) => x.category === 'scale');
  assert.ok(scale.length >= 1, 'a numeric scale requirement should be captured');
});

test('a multi-deliverable SE utterance becomes MULTIPLE actions (S4/S20)', () => {
  const r = analyzeTranscript(`${SE}\nDan (VP Engineering, Northwind): we need a POC\nPriya (Sales Engineer, Acme): Let me line up a POC plan, confirm the Snowflake write-back, and send the security pack.`);
  const titles = r.actions.filter((a) => a.owner === 'SE').map((a) => a.title.toLowerCase());
  assert.ok(titles.some((t) => /line up a poc/.test(t)), 'POC action missing');
  assert.ok(titles.some((t) => /confirm the snowflake/.test(t)), 'write-back action missing');
  assert.ok(titles.some((t) => /send the security/.test(t)), 'security-pack action missing');
});

test('a deliverable in a LATER sentence is captured, not the confirmation in the first (S20)', () => {
  // "…are supported. I'll get you the report." -> the action is the report, not the confirmation.
  const a = seAction('EU residency and Okta SSO are both supported. I\'ll get you our SOC 2 report.');
  assert.match(a.title, /get you our SOC 2 report/i);
  assert.doesNotMatch(a.title, /are both supported/i);
});
