import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { buildIndex, parseDoc, retrieve } from '../src/library.js';
import { LibraryStore } from '../src/store.js';

test('parseDoc splits markdown headings into stable passages with heading + line metadata', () => {
  const parsed = parseDoc('Security FAQ.md', [
    '# Security',
    '',
    'Okta SSO is supported.',
    'EU data residency is available.',
    '',
    '## Integrations',
    'We integrate with Snowflake natively.',
  ].join('\n'), { docId: 'sec-doc' });

  assert.equal(parsed.passages.length, 2);
  assert.deepEqual(
    parsed.passages.map((passage) => ({
      passageId: passage.passageId,
      heading: passage.heading,
      line: passage.line,
    })),
    [
      { passageId: 'sec-doc:1', heading: 'Security', line: 3 },
      { passageId: 'sec-doc:2', heading: 'Integrations', line: 7 },
    ],
  );
});

test('retrieve hits the right category and rejects a near-miss below threshold', () => {
  const index = buildIndex([
    {
      docId: 'security-faq',
      docName: 'Security FAQ.md',
      text: '# Security\nOkta SSO is supported.\nEU data residency is available.\n\n## Integrations\nWe integrate with Snowflake natively.',
    },
    {
      docId: 'scale-note',
      docName: 'Scale.md',
      text: 'We process 50 million events per day with minute-level alert latency.',
    },
  ]);

  const securityHit = retrieve(index, 'Security & compliance — can you meet: We need SSO via Okta and EU data residency?', { category: 'security' });
  const nearMiss = retrieve(index, 'Security & compliance — can you meet: We need SAML SSO for every admin?', { category: 'scale' });

  assert.equal(securityHit.docName, 'Security FAQ.md');
  assert.equal(securityHit.heading, 'Security');
  assert.match(securityHit.quote, /Okta SSO is supported/);
  assert.equal(nearMiss, null);
});

test('LibraryStore persists docs across a fresh instance and never uses the raw doc name as a file path', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'slipstream-library-'));
  t.after(async () => rm(dir, { recursive: true, force: true }));

  const first = await new LibraryStore(dir).init();
  const saved = await first.addDocument({
    name: '../../security/faq.md',
    text: '# Security\nOkta SSO is supported.\n',
    contentType: 'text/markdown',
  });

  const files = await readdir(dir);
  assert.ok(files.includes('manifest.json'));
  assert.ok(files.some((file) => file === `${saved.docId}.json`));
  assert.ok(!files.some((file) => file.includes('faq') || file.includes('security')));

  const second = await new LibraryStore(dir).init();
  assert.equal(second.listDocuments().length, 1);

  const hit = retrieve(second.getIndex(), 'We need SSO via Okta.', { category: 'security' });
  assert.equal(hit.docId, saved.docId);
});
