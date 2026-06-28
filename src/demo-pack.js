import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DEMO_TIMELINE = {
  dealCreatedAt: '2026-06-18T15:00:00.000Z',
  discoveryCallAt: '2026-06-18T15:05:00.000Z',
  followupCallAt: '2026-06-20T16:15:00.000Z',
  returnAt: '2026-06-20T16:20:00.000Z',
  csvExportAt: '2026-06-20T16:22:00.000Z',
  jsonExportAt: '2026-06-20T16:23:00.000Z',
};

const DEMO_DOC_FILES = [
  { name: 'Security Overview.md', file: 'demo-security-overview.md' },
  { name: 'Platform Brief.md', file: 'demo-platform-brief.md' },
];

const DEMO_CALL_FILES = [
  { label: 'Discovery call', file: 'discovery-call.txt', createdAt: DEMO_TIMELINE.discoveryCallAt },
  { label: 'Technical follow-up', file: 'follow-up-call.txt', createdAt: DEMO_TIMELINE.followupCallAt },
];

async function readSample(rootDir, fileName) {
  return readFile(join(rootDir, 'samples', fileName), 'utf8');
}

export async function seedDemoPack({ rootDir, libraryStore, dealStore, telemetryStore, extractDealResult }) {
  for (const doc of DEMO_DOC_FILES) {
    await libraryStore.addDocument({
      name: doc.name,
      text: await readSample(rootDir, doc.file),
      contentType: 'text/markdown',
    });
  }

  const demoDeal = await dealStore.createDeal(
    { title: 'Northwind Logistics', account: 'Northwind Logistics' },
    { now: () => DEMO_TIMELINE.dealCreatedAt },
  );

  let currentDeal = demoDeal;
  for (const call of DEMO_CALL_FILES) {
    const transcript = await readSample(rootDir, call.file);
    const extracted = await extractDealResult({ transcript, useLlm: false });
    currentDeal = await dealStore.addCall(
      demoDeal.id,
      {
        transcript,
        label: call.label,
        meta: extracted.meta,
        result: extracted.result,
      },
      { now: () => call.createdAt },
    );

    const latestCall = currentDeal.calls[currentDeal.calls.length - 1];
    await telemetryStore.record('call_processed', {
      dealId: demoDeal.id,
      callId: latestCall?.id || null,
      callLabel: latestCall?.label || null,
      callCount: currentDeal.calls.length,
      engine: extracted.meta.engine,
      model: extracted.meta.model,
      createdAt: call.createdAt,
    });
  }

  const view = dealStore.buildView(demoDeal.id);
  await telemetryStore.record('deal_returned', {
    dealId: demoDeal.id,
    callCount: currentDeal.calls.length,
    createdAt: DEMO_TIMELINE.returnAt,
  });
  await telemetryStore.record('export_clicked', {
    dealId: demoDeal.id,
    exportKind: 'csv',
    callCount: currentDeal.calls.length,
    actionCount: Array.isArray(view?.result?.actions) ? view.result.actions.length : 0,
    createdAt: DEMO_TIMELINE.csvExportAt,
  });
  await telemetryStore.record('export_clicked', {
    dealId: demoDeal.id,
    exportKind: 'json',
    callCount: currentDeal.calls.length,
    actionCount: Array.isArray(view?.result?.actions) ? view.result.actions.length : 0,
    createdAt: DEMO_TIMELINE.jsonExportAt,
  });

  return {
    demoDealId: demoDeal.id,
    deal: currentDeal,
    view,
  };
}
