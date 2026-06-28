import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeTranscript } from '../src/engine.js';
import { buildIndex } from '../src/library.js';

function libraryIndex() {
  return buildIndex([
    {
      docId: 'security-faq',
      docName: 'Security FAQ.md',
      text: '# Security\nOkta SSO is supported.\nEU data residency is available.\n\n## Scale\nWe process 50 million events per day.',
    },
  ]);
}

test('empty library is byte-for-byte back-compatible', () => {
  const transcript = [
    'Priya (Sales Engineer, Acme): Thanks for the time.',
    'Maria (Security Lead, Northwind): We need SSO via Okta and EU data residency.',
  ].join('\n');

  assert.deepEqual(
    analyzeTranscript(transcript),
    analyzeTranscript(transcript, { libraryIndex: buildIndex([]) }),
  );
});

test('library match verifies an unanswered RFP row with doc + section metadata', () => {
  const transcript = [
    'Priya (Sales Engineer, Acme): Thanks for the time.',
    'Maria (Security Lead, Northwind): We need SSO via Okta and EU data residency.',
  ].join('\n');

  const row = analyzeTranscript(transcript, { libraryIndex: libraryIndex() }).rfpRows.find((entry) => /security/i.test(entry.question));

  assert.equal(row.status, 'verified');
  assert.equal(row.answerSource, 'library');
  assert.equal(row.libraryEvidence.docName, 'Security FAQ.md');
  assert.equal(row.libraryEvidence.heading, 'Security');
  assert.match(row.suggestedAnswer, /Okta SSO is supported/);
});

test('in-call confirmation beats the library when both exist', () => {
  const transcript = [
    'Maria (Security Lead, Northwind): We need SSO via Okta and EU data residency.',
    'Priya (Sales Engineer, Acme): Okta SSO and EU residency are supported.',
  ].join('\n');

  const row = analyzeTranscript(transcript, { libraryIndex: libraryIndex() }).rfpRows.find((entry) => /security/i.test(entry.question));

  assert.equal(row.status, 'verified');
  assert.equal(row.answerSource, 'call');
  assert.equal(row.libraryEvidence, null);
  assert.match(row.suggestedAnswer, /Confirmed on the call/);
});

test('a contested category suppresses the library instead of laundering a stale doc claim', () => {
  const transcript = [
    'Maria (Security Lead, Northwind): We need SSO via Okta and EU data residency.',
    'Priya (Sales Engineer, Acme): Okta SSO is not available yet for your region.',
  ].join('\n');

  const row = analyzeTranscript(transcript, { libraryIndex: libraryIndex() }).rfpRows.find((entry) => /security/i.test(entry.question));

  assert.equal(row.status, 'unverified');
  assert.equal(row.answerSource, 'none');
  assert.equal(row.libraryEvidence, null);
  assert.match(row.suggestedAnswer, /\[Draft/);
});

test('a category-mismatched passage stays unverified', () => {
  const transcript = [
    'Priya (Sales Engineer, Acme): Thanks for the time.',
    'Dan (VP Engineering, Northwind): We need Snowflake write-back.',
  ].join('\n');

  const row = analyzeTranscript(transcript, {
    libraryIndex: buildIndex([
      {
        docId: 'scale-only',
        docName: 'Scale.md',
        text: 'We process 50 million events per day with minute-level alert latency.',
      },
    ]),
  }).rfpRows.find((entry) => /integration/i.test(entry.question));

  assert.equal(row.status, 'unverified');
  assert.equal(row.answerSource, 'none');
});
