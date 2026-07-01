import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const regressionCallOne = [
  '[00:00] Priya (SE, Slipstream): Thanks for making time.',
  '[00:12] Lena (CFO, Acme): Before procurement starts, I need ROI proof and the pricing package.',
  '[00:24] Raj (Security Lead, Acme): Can you confirm whether onboarding support is included in the pilot?',
].join('\n');

const regressionCallTwo = [
  '[00:00] Priya (SE, Slipstream): Let us focus on the POC scope today.',
  '[00:18] Pat (VP Engineering, Acme): The POC needs BigQuery write-back live before we sign off.',
].join('\n');

const regressionCallThree = [
  '[00:00] Priya (SE, Slipstream): We can cover the commercial close items before legal starts.',
  '[00:12] Lena (CFO, Acme): Before legal can open procurement, I need the commercial justification deck and exact pricing.',
].join('\n');

const regressionCallFour = [
  '[00:00] Priya (SE, Slipstream): Let me line up the legal follow-up.',
  '[00:12] Lena (CFO, Acme): I need the pricing package and ROI proof before legal approves.',
].join('\n');

let serverImportCounter = 0;

async function startServer(t) {
  const { server } = await import(`../src/server.js?server-deals-history=${serverImportCounter++}`);
  t.after(async () => new Promise((resolve) => server.close(resolve)));
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));
  return server;
}

test('saved deal API keeps historical commercial and open-question blockers after a later technical-only follow-up', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'slipstream-server-deals-history-'));
  const dealsDir = join(root, 'deals');
  const telemetryDir = join(root, 'telemetry');
  const libraryDir = join(root, 'library');

  t.after(async () => rm(root, { recursive: true, force: true }));

  process.env.SLIPSTREAM_DEALS_DIR = dealsDir;
  process.env.SLIPSTREAM_TELEMETRY_DIR = telemetryDir;
  process.env.SLIPSTREAM_DATA_DIR = libraryDir;
  process.env.PORT = '0';
  process.env.HOST = '127.0.0.1';

  const server = await startServer(t);

  const base = `http://127.0.0.1:${server.address().port}`;

  let res = await fetch(`${base}/api/deals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Acme renewal' }),
  });
  let data = await res.json();
  assert.equal(res.status, 200);
  const dealId = data.deal.id;

  res = await fetch(`${base}/api/deals/${encodeURIComponent(dealId)}/calls`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transcript: regressionCallOne, useLlm: false, label: 'Discovery call' }),
  });
  data = await res.json();
  assert.equal(res.status, 200);

  res = await fetch(`${base}/api/deals/${encodeURIComponent(dealId)}/calls`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transcript: regressionCallTwo, useLlm: false, label: 'Technical follow-up' }),
  });
  data = await res.json();
  assert.equal(res.status, 200);

  const lenaGaps = data.brief.stakeholderGaps.find((group) => group.name === 'Lena');
  const rajGaps = data.brief.stakeholderGaps.find((group) => group.name === 'Raj');

  assert.ok(lenaGaps, 'historical commercial blocker should survive on the deal brief');
  assert.ok(lenaGaps.items.some((item) => item.category === 'commercial' && /ROI proof/i.test(item.title)));
  assert.ok(rajGaps, 'historical open question should survive on the deal brief');
  assert.ok(rajGaps.items.some((item) => item.category === 'open_question' && /onboarding support/i.test(item.title)));
  assert.ok(data.brief.nextQuestions.some((item) => /pricing package and ROI proof/i.test(item.question)));
  assert.ok(data.brief.nextQuestions.some((item) => /lock the next step/i.test(item.question)));
});

test('saved deal API dedupes repeated historical blockers and keeps the newest citation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'slipstream-server-deals-history-repeat-'));
  const dealsDir = join(root, 'deals');
  const telemetryDir = join(root, 'telemetry');
  const libraryDir = join(root, 'library');

  t.after(async () => rm(root, { recursive: true, force: true }));

  process.env.SLIPSTREAM_DEALS_DIR = dealsDir;
  process.env.SLIPSTREAM_TELEMETRY_DIR = telemetryDir;
  process.env.SLIPSTREAM_DATA_DIR = libraryDir;
  process.env.PORT = '0';
  process.env.HOST = '127.0.0.1';

  const server = await startServer(t);

  const base = `http://127.0.0.1:${server.address().port}`;

  let res = await fetch(`${base}/api/deals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Acme renewal' }),
  });
  let data = await res.json();
  assert.equal(res.status, 200);
  const dealId = data.deal.id;

  for (const [label, transcript] of [
    ['Discovery call', regressionCallOne],
    ['Technical follow-up', regressionCallTwo],
    ['Commercial restatement', regressionCallThree],
  ]) {
    res = await fetch(`${base}/api/deals/${encodeURIComponent(dealId)}/calls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transcript, useLlm: false, label }),
    });
    data = await res.json();
    assert.equal(res.status, 200);
  }

  const lenaGaps = data.brief.stakeholderGaps.find((group) => group.name === 'Lena');
  const lenaCommercialItems = lenaGaps?.items.filter((item) => item.category === 'commercial') || [];

  assert.equal(lenaCommercialItems.length, 1, 'same stakeholder blocker should collapse to one commercial gap');
  assert.match(lenaCommercialItems[0]?.title || '', /commercial justification deck and exact pricing/i);
  assert.equal(lenaCommercialItems[0]?.transcriptEvidence?.callLabel, 'Commercial restatement');
});

test('saved deal API dedupes repeated historical blocker restatements and keeps the newest call citation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'slipstream-server-deals-history-dedupe-'));
  const dealsDir = join(root, 'deals');
  const telemetryDir = join(root, 'telemetry');
  const libraryDir = join(root, 'library');

  t.after(async () => rm(root, { recursive: true, force: true }));

  process.env.SLIPSTREAM_DEALS_DIR = dealsDir;
  process.env.SLIPSTREAM_TELEMETRY_DIR = telemetryDir;
  process.env.SLIPSTREAM_DATA_DIR = libraryDir;
  process.env.PORT = '0';
  process.env.HOST = '127.0.0.1';

  const server = await startServer(t);

  const base = `http://127.0.0.1:${server.address().port}`;

  let res = await fetch(`${base}/api/deals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Acme renewal' }),
  });
  let data = await res.json();
  assert.equal(res.status, 200);
  const dealId = data.deal.id;

  for (const [label, transcript] of [
    ['Call 1', regressionCallOne],
    ['Call 2', regressionCallTwo],
    ['Call 3', regressionCallFour],
  ]) {
    res = await fetch(`${base}/api/deals/${encodeURIComponent(dealId)}/calls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transcript, useLlm: false, label }),
    });
    data = await res.json();
    assert.equal(res.status, 200);
  }

  const lenaGaps = data.brief.stakeholderGaps.find((group) => group.name === 'Lena');
  const lenaQuestions = data.brief.nextQuestions.filter((item) => item.stakeholder === 'Lena');

  assert.ok(lenaGaps, 'repeated blocker should still be present for Lena');
  assert.equal(lenaGaps.items.length, 1, 'repeated blocker should collapse to one stakeholder gap item');
  assert.match(lenaGaps.items[0].title, /pricing package and roi proof/i);
  assert.equal(lenaGaps.items[0].transcriptEvidence?.label, 'Call 3 · line 2');
  assert.equal(lenaQuestions.length, 1, 'repeated blocker should only yield one next question');
  assert.equal(lenaQuestions[0].transcriptEvidence?.label, 'Call 3 · line 2');
  assert.ok(!data.brief.recentChanges.some((item) => /pricing package and roi proof/i.test(item.title)), 'restated blocker should not be treated as a net-new change');
});

test('saved deal API keeps distinct commercial blockers that only share pricing and procurement context', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'slipstream-server-deals-history-distinct-'));
  const dealsDir = join(root, 'deals');
  const telemetryDir = join(root, 'telemetry');
  const libraryDir = join(root, 'library');

  t.after(async () => rm(root, { recursive: true, force: true }));

  process.env.SLIPSTREAM_DEALS_DIR = dealsDir;
  process.env.SLIPSTREAM_TELEMETRY_DIR = telemetryDir;
  process.env.SLIPSTREAM_DATA_DIR = libraryDir;
  process.env.PORT = '0';
  process.env.HOST = '127.0.0.1';

  const server = await startServer(t);
  const base = `http://127.0.0.1:${server.address().port}`;

  let res = await fetch(`${base}/api/deals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Acme renewal' }),
  });
  let data = await res.json();
  assert.equal(res.status, 200);
  const dealId = data.deal.id;

  for (const [label, transcript] of [
    ['Call 1', [
      '[00:00] Priya (SE, Slipstream): Let us map the commercial blockers first.',
      '[00:12] Lena (CFO, Acme): Before procurement starts, I need pricing package and ROI proof.',
    ].join('\n')],
    ['Call 2', [
      '[00:00] Priya (SE, Slipstream): Let us isolate the second blocker.',
      '[00:12] Lena (CFO, Acme): Before procurement starts, I need pricing redlines and legal terms.',
    ].join('\n')],
  ]) {
    res = await fetch(`${base}/api/deals/${encodeURIComponent(dealId)}/calls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transcript, useLlm: false, label }),
    });
    data = await res.json();
    assert.equal(res.status, 200);
  }

  const lenaGaps = data.brief.stakeholderGaps.find((group) => group.name === 'Lena');
  const lenaCommercialItems = lenaGaps?.items.filter((item) => item.category === 'commercial') || [];

  assert.equal(lenaCommercialItems.length, 2, 'distinct commercial blockers should both remain visible on the deal brief');
  assert.ok(lenaCommercialItems.some((item) => /pricing package and roi proof/i.test(item.title)));
  assert.ok(lenaCommercialItems.some((item) => /pricing redlines and legal terms/i.test(item.title)));
});

test('saved deal API keeps one-token commercial expansions in recent changes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'slipstream-server-deals-history-recent-'));
  const dealsDir = join(root, 'deals');
  const telemetryDir = join(root, 'telemetry');
  const libraryDir = join(root, 'library');

  t.after(async () => rm(root, { recursive: true, force: true }));

  process.env.SLIPSTREAM_DEALS_DIR = dealsDir;
  process.env.SLIPSTREAM_TELEMETRY_DIR = telemetryDir;
  process.env.SLIPSTREAM_DATA_DIR = libraryDir;
  process.env.PORT = '0';
  process.env.HOST = '127.0.0.1';

  const server = await startServer(t);
  const base = `http://127.0.0.1:${server.address().port}`;

  let res = await fetch(`${base}/api/deals`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Acme renewal' }),
  });
  let data = await res.json();
  assert.equal(res.status, 200);
  const dealId = data.deal.id;

  for (const [label, transcript] of [
    ['Call 1', [
      '[00:00] Priya (SE, Slipstream): Let us review the procurement path.',
      '[00:12] Lena (CFO, Acme): Before procurement starts, I need the pricing package.',
    ].join('\n')],
    ['Call 2', [
      '[00:00] Priya (SE, Slipstream): Let us capture the updated pricing need.',
      '[00:12] Lena (CFO, Acme): Before procurement starts, I need the pricing package discount.',
    ].join('\n')],
  ]) {
    res = await fetch(`${base}/api/deals/${encodeURIComponent(dealId)}/calls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transcript, useLlm: false, label }),
    });
    data = await res.json();
    assert.equal(res.status, 200);
  }

  assert.ok(data.brief.recentChanges.some((item) => /pricing package discount/i.test(item.title)), 'latest one-token expansion should remain a visible change');
});
