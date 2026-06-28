import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { analyzeTranscript } from '../src/engine.js';
import {
  createThreadRecord,
  appendCallToThread,
  aggregateThreadResult,
  buildThreadView,
  loadThreads,
  saveThreads,
} from '../web/threads.js';

const dir = dirname(fileURLToPath(import.meta.url));
const callOne = readFileSync(join(dir, '../samples/discovery-call.txt'), 'utf8');
const callTwo = readFileSync(join(dir, '../samples/follow-up-call.txt'), 'utf8');

function fakeStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test('thread aggregation preserves prior verified rows and annotates evidence with call labels', () => {
  let thread = createThreadRecord({ title: 'Northwind thread' }, { now: () => '2026-06-26T12:00:00.000Z' });
  thread = appendCallToThread(thread, {
    transcript: callOne,
    meta: { engine: 'deterministic', durationMs: 11 },
    result: analyzeTranscript(callOne),
    label: 'Discovery call',
  }, { now: () => '2026-06-26T12:00:01.000Z' });
  thread = appendCallToThread(thread, {
    transcript: callTwo,
    meta: { engine: 'deterministic', durationMs: 9 },
    result: analyzeTranscript(callTwo),
    label: 'Follow-up call',
  }, { now: () => '2026-06-26T12:00:02.000Z' });

  const aggregate = aggregateThreadResult(thread);
  const northwindSecurity = aggregate.rfpRows.find((row) => /SOC 2/i.test(row.question) || /security/i.test(row.question));
  const questionnaireAction = aggregate.actions.find((action) => /questionnaire/i.test(action.title));

  assert.equal(thread.calls.length, 2);
  assert.ok(aggregate.actions.length >= thread.calls[0].result.actions.length, 'aggregate keeps prior actions');
  assert.ok(northwindSecurity, 'aggregate keeps verified or unverified RFP continuity');
  assert.equal(aggregate.crmFields.Account, 'Northwind');
  assert.ok(questionnaireAction, 'follow-up call adds new findings');
  assert.equal(questionnaireAction.evidence.callLabel, 'Follow-up call');
  assert.match(aggregate.analytics.note, /2 saved calls/);
});

test('thread storage round-trips and thread view exposes aggregate header metadata', () => {
  const storage = fakeStorage();
  const thread = appendCallToThread(
    createThreadRecord({ title: 'Northwind thread' }, { now: () => '2026-06-26T12:10:00.000Z' }),
    {
      transcript: callOne,
      meta: { engine: 'deterministic', durationMs: 7 },
      result: analyzeTranscript(callOne),
      label: 'Discovery call',
    },
    { now: () => '2026-06-26T12:10:01.000Z' },
  );

  saveThreads([thread], storage);
  const loaded = loadThreads(storage);
  const view = buildThreadView(loaded[0]);

  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].calls[0].label, 'Discovery call');
  assert.equal(view.head.title, 'Northwind thread');
  assert.match(view.head.subtitle, /1 call/);
  assert.equal(view.meta.engine, 'saved-workspace');
});
