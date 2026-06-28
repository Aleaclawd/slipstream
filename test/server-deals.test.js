import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DealStore } from '../src/deal-store.js';
import { TelemetryStore } from '../src/telemetry-store.js';

const dir = dirname(fileURLToPath(import.meta.url));
const callOne = readFileSync(join(dir, '../samples/discovery-call.txt'), 'utf8');
const callTwo = readFileSync(join(dir, '../samples/follow-up-call.txt'), 'utf8');

test('saved deal API persists calls across reload and logs local telemetry events', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'slipstream-server-deals-'));
  const dealsDir = join(root, 'deals');
  const telemetryDir = join(root, 'telemetry');
  const libraryDir = join(root, 'library');

  t.after(async () => rm(root, { recursive: true, force: true }));

  process.env.SLIPSTREAM_DEALS_DIR = dealsDir;
  process.env.SLIPSTREAM_TELEMETRY_DIR = telemetryDir;
  process.env.SLIPSTREAM_DATA_DIR = libraryDir;
  process.env.PORT = '0';
  process.env.HOST = '127.0.0.1';

  const { server } = await import('../src/server.js');
  t.after(async () => new Promise((resolve) => server.close(resolve)));
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));

  const base = `http://127.0.0.1:${server.address().port}`;

  let res = await fetch(`${base}/api/deals`);
  let data = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(data.deals, []);

  res = await fetch(`${base}/api/deals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Northwind expansion' }),
  });
  data = await res.json();
  assert.equal(res.status, 200);
  const dealId = data.deal.id;
  assert.equal(data.deal.title, 'Northwind expansion');

  res = await fetch(`${base}/api/deals/${encodeURIComponent(dealId)}/calls`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transcript: callOne, useLlm: false, label: 'Discovery call' }),
  });
  data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.deal.calls.length, 1);
  assert.equal(data.view.head.dealId, dealId);
  assert.match(data.view.meta.note, /saved deal workspace/i);

  res = await fetch(`${base}/api/deals/${encodeURIComponent(dealId)}/calls`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transcript: callTwo, useLlm: false, label: 'Follow-up call' }),
  });
  data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.deal.calls.length, 2);
  assert.equal(data.deal.calls[1].label, 'Follow-up call');

  const reloadedStore = await new DealStore(dealsDir).init();
  const reloadedDeal = reloadedStore.getDeal(dealId);
  assert.ok(reloadedDeal, 'deal persists on disk');
  assert.equal(reloadedDeal.calls.length, 2);
  assert.equal(reloadedDeal.calls[0].label, 'Discovery call');

  res = await fetch(`${base}/api/deals/${encodeURIComponent(dealId)}/return`, { method: 'POST' });
  data = await res.json();
  assert.equal(res.status, 200);
  assert.match(data.view.head.subtitle, /2 call/);

  res = await fetch(`${base}/api/export/csv`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dealId, result: data.view.result }),
  });
  const csv = await res.text();
  assert.equal(res.status, 200);
  assert.match(csv, /type,title_or_question,detail/);

  res = await fetch(`${base}/api/export/json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...data.view, dealId }),
  });
  const json = await res.text();
  assert.equal(res.status, 200);
  assert.doesNotMatch(json, /"dealId"/);
  assert.match(json, /Northwind expansion/);

  const telemetry = await new TelemetryStore(telemetryDir).init();
  const events = await telemetry.listEvents();
  const callEvents = events.filter((event) => event.type === 'call_processed');
  const exportEvents = events.filter((event) => event.type === 'export_clicked');
  const returnEvents = events.filter((event) => event.type === 'deal_returned');

  assert.equal(callEvents.length, 2);
  assert.deepEqual(callEvents.map((event) => event.callCount), [1, 2]);
  assert.equal(returnEvents.length, 1);
  assert.equal(returnEvents[0].dealId, dealId);
  assert.equal(exportEvents.length, 2);
  assert.deepEqual(exportEvents.map((event) => event.exportKind).sort(), ['csv', 'json']);
});
