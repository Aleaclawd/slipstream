import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('library API persists docs, extracts library-grounded rows, exports doc + section, and rejects non-text uploads', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'slipstream-server-library-'));
  t.after(async () => rm(dir, { recursive: true, force: true }));

  process.env.SLIPSTREAM_DATA_DIR = dir;
  process.env.PORT = '0';
  process.env.HOST = '127.0.0.1';

  const { server } = await import('../src/server.js');
  t.after(async () => new Promise((resolve) => server.close(resolve)));
  if (!server.listening) await new Promise((resolve) => server.once('listening', resolve));

  const base = `http://127.0.0.1:${server.address().port}`;

  let res = await fetch(`${base}/api/library`);
  let data = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(data.docs, []);

  res = await fetch(`${base}/api/library`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Security FAQ.md',
      text: '# Security\nOkta SSO is supported.\nEU data residency is available.\n',
      contentType: 'text/markdown',
    }),
  });
  data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.docs.length, 1);
  assert.equal(data.doc.docName, 'Security FAQ.md');

  res = await fetch(`${base}/api/library`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'security.pdf',
      text: '%PDF-pretend',
      contentType: 'application/pdf',
    }),
  });
  data = await res.json();
  assert.equal(res.status, 415);
  assert.match(data.error, /unsupported upload type/i);

  const transcript = [
    'Priya (Sales Engineer, Acme): Thanks for the time.',
    'Maria (Security Lead, Northwind): We need SSO via Okta and EU data residency.',
  ].join('\n');

  res = await fetch(`${base}/api/extract`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transcript, useLlm: false }),
  });
  const extract = await res.json();
  assert.equal(res.status, 200);
  const row = extract.result.rfpRows.find((entry) => /security/i.test(entry.question));
  assert.equal(row.answerSource, 'library');
  assert.equal(row.libraryEvidence.docName, 'Security FAQ.md');
  assert.equal(row.libraryEvidence.heading, 'Security');

  res = await fetch(`${base}/api/export/csv`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ result: extract.result }),
  });
  const csv = await res.text();
  assert.match(csv, /source_doc,source_section/);
  assert.match(csv, /Security FAQ\.md/);
  assert.match(csv, /Security/);

  res = await fetch(`${base}/api/export/json`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(extract),
  });
  const json = await res.text();
  assert.match(json, /"docName": "Security FAQ\.md"/);
  assert.match(json, /"heading": "Security"/);

  res = await fetch(`${base}/api/library/${encodeURIComponent(data.doc?.docId || extract.result.rfpRows[0].libraryEvidence.docId)}`, { method: 'DELETE' });
  data = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(data.docs, []);
});
