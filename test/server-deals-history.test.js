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

  const { server } = await import('../src/server.js');
  t.after(async () => new Promise((resolve) => server.close(resolve)));
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));

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
