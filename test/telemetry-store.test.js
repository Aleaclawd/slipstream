import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { TelemetryStore } from '../src/telemetry-store.js';

test('TelemetryStore summarizes local engagement events by type, export kind, and deal', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'slipstream-telemetry-'));
  t.after(async () => rm(dir, { recursive: true, force: true }));

  const store = await new TelemetryStore(dir).init();
  await store.record('call_processed', {
    dealId: 'northwind-1',
    callLabel: 'Discovery call',
    callCount: 1,
    engine: 'deterministic',
    createdAt: '2026-06-18T15:05:00.000Z',
  });
  await store.record('deal_returned', {
    dealId: 'northwind-1',
    callCount: 1,
    createdAt: '2026-06-18T15:10:00.000Z',
  });
  await store.record('export_clicked', {
    dealId: 'northwind-1',
    exportKind: 'csv',
    callCount: 1,
    createdAt: '2026-06-18T15:11:00.000Z',
  });
  await store.record('call_processed', {
    dealId: 'northwind-1',
    callLabel: 'Technical follow-up',
    callCount: 2,
    engine: 'deterministic',
    createdAt: '2026-06-20T16:15:00.000Z',
  });
  await store.record('export_clicked', {
    dealId: 'northwind-1',
    exportKind: 'json',
    callCount: 2,
    createdAt: '2026-06-20T16:23:00.000Z',
  });

  const summary = await store.summarize();

  assert.deepEqual(summary.totals, {
    totalEvents: 5,
    callProcessed: 2,
    exportClicked: 2,
    dealReturned: 1,
  });
  assert.deepEqual(summary.exportsByKind, { csv: 1, json: 1, markdown: 0, html: 0, webhook: 0 });
  assert.equal(summary.latestEventAt, '2026-06-20T16:23:00.000Z');
  assert.equal(summary.deals.length, 1);
  assert.deepEqual(summary.deals[0], {
    dealId: 'northwind-1',
    callProcessed: 2,
    exportClicked: 2,
    dealReturned: 1,
    callCount: 2,
    lastCallLabel: 'Technical follow-up',
    lastExportKind: 'json',
    lastEngine: 'deterministic',
    lastEventAt: '2026-06-20T16:23:00.000Z',
  });
  assert.equal(summary.recentEvents[0].type, 'export_clicked');
  assert.equal(summary.recentEvents[0].exportKind, 'json');
  assert.equal(summary.recentEvents[1].callLabel, 'Technical follow-up');
});
