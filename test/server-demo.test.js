import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { DealStore } from '../src/deal-store.js';
import { LibraryStore } from '../src/store.js';
import { TelemetryStore } from '../src/telemetry-store.js';

test('demo API seeds the private demo pack, persists it locally, and resets cleanly', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'slipstream-server-demo-'));
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

  let res = await fetch(`${base}/api/demo/load`, { method: 'POST' });
  let data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.deals.length, 1);
  assert.equal(data.docs.length, 2);
  assert.equal(data.deal.calls.length, 2);
  assert.equal(data.view.head.title, 'Northwind Logistics');
  assert.equal(data.dashboard.totals.callProcessed, 2);
  assert.equal(data.dashboard.totals.exportClicked, 2);
  assert.equal(data.dashboard.totals.dealReturned, 1);
  assert.deepEqual(data.dashboard.exportsByKind, { csv: 1, json: 1, webhook: 0 });
  assert.equal(data.dashboard.deals[0].dealTitle, 'Northwind Logistics');

  const persistedDeals = await new DealStore(dealsDir).init();
  const persistedLibrary = await new LibraryStore(libraryDir).init();
  const persistedTelemetry = await new TelemetryStore(telemetryDir).init();
  assert.equal(persistedDeals.listDeals().length, 1);
  assert.equal(persistedDeals.listDeals()[0].calls.length, 2);
  assert.equal(persistedLibrary.listDocuments().length, 2);
  assert.equal((await persistedTelemetry.listEvents()).length, 5);

  res = await fetch(`${base}/api/dashboard`);
  data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.summary.recentEvents.length, 5);
  assert.equal(data.summary.recentEvents[0].exportKind, 'json');

  res = await fetch(`${base}/api/demo/reset`, { method: 'POST' });
  data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.reset, true);
  assert.deepEqual(data.deals, []);
  assert.deepEqual(data.docs, []);
  assert.deepEqual(data.dashboard.totals, {
    totalEvents: 0,
    callProcessed: 0,
    exportClicked: 0,
    dealReturned: 0,
  });
  assert.deepEqual(data.dashboard.deals, []);

  assert.deepEqual((await new DealStore(dealsDir).init()).listDeals(), []);
  assert.deepEqual((await new LibraryStore(libraryDir).init()).listDocuments(), []);
  assert.deepEqual(await (await new TelemetryStore(telemetryDir).init()).listEvents(), []);
});
