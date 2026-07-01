import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeTranscript } from '../src/engine.js';
import { buildIndex } from '../src/library.js';
import { buildDealBrief, renderDealBriefHtml, renderDealBriefMarkdown } from '../web/deal-brief.js';
import { appendCallToThread, createThreadRecord } from '../web/threads.js';

const dir = dirname(fileURLToPath(import.meta.url));
const discoveryCall = readFileSync(join(dir, '../samples/discovery-call.txt'), 'utf8');
const followupCall = readFileSync(join(dir, '../samples/follow-up-call.txt'), 'utf8');
const securityDoc = readFileSync(join(dir, '../samples/demo-security-overview.md'), 'utf8');
const platformDoc = readFileSync(join(dir, '../samples/demo-platform-brief.md'), 'utf8');

test('deal brief builds anchored transcript and library citations from a saved workspace', () => {
  const libraryIndex = buildIndex([
    { docId: 'security-doc', docName: 'Security Overview.md', text: securityDoc, createdAt: '2026-06-18T15:00:00.000Z' },
    { docId: 'platform-doc', docName: 'Platform Brief.md', text: platformDoc, createdAt: '2026-06-18T15:00:00.000Z' },
  ]);

  let deal = createThreadRecord(
    { title: 'Northwind Logistics', account: 'Northwind Logistics' },
    { now: () => '2026-06-18T15:00:00.000Z' },
  );
  deal = appendCallToThread(deal, {
    transcript: discoveryCall,
    label: 'Discovery call',
    meta: { engine: 'deterministic', durationMs: 12 },
    result: analyzeTranscript(discoveryCall, { libraryIndex }),
  }, { now: () => '2026-06-18T15:05:00.000Z' });
  deal = appendCallToThread(deal, {
    transcript: followupCall,
    label: 'Technical follow-up',
    meta: { engine: 'deterministic', durationMs: 14 },
    result: analyzeTranscript(followupCall, { libraryIndex }),
  }, { now: () => '2026-06-20T16:15:00.000Z' });

  const brief = buildDealBrief({ deal, libraryIndex, generatedAt: '2026-06-20T16:30:00.000Z' });
  const markdown = renderDealBriefMarkdown(brief);
  const html = renderDealBriefHtml(brief);

  assert.equal(brief.callCount, 2);
  assert.ok(brief.stakeholders.some((item) => item.badges.includes('Economic Buyer')));
  assert.ok(brief.stakeholders.some((item) => item.badges.includes('Champion')));
  assert.ok(brief.topAction);
  assert.equal(brief.topAction.title, 'Send the completed questionnaire and pricing by Friday');
  assert.match(brief.topAction.detail, /by Friday/i);
  assert.ok(brief.topAction.evidence?.href);
  assert.ok(brief.recentChanges.some((item) => /Lena joined the buying committee/i.test(item.title) && item.evidence?.href));
  assert.ok(brief.recentChanges.some((item) => /BigQuery/i.test(item.title)));
  assert.ok(brief.stakeholderGaps.some((group) => group.name === 'Lena' && group.items.some((item) => /pricing|ROI/i.test(item.detail))));
  assert.ok(brief.nextQuestions.some((item) => /pricing package and ROI proof/i.test(item.question) && item.transcriptEvidence?.href));
  assert.ok(brief.verifiedRequirements.length >= 2, 'expected verified requirements from local docs');
  assert.ok(Array.isArray(brief.openGaps));
  assert.ok(brief.libraryCitations.some((item) => item.docName === 'Security Overview.md'));
  assert.ok(brief.transcriptAppendix[0].lines.some((line) => line.anchorId.includes('brief-transcript')));
  assert.ok(brief.libraryAppendix[0].anchorId.includes('brief-library'));
  assert.match(markdown, /# Northwind Logistics/);
  assert.match(markdown, /## Changed since the prior call/);
  assert.match(markdown, /## Suggested next questions/);
  assert.match(markdown, /\[Discovery call · line \d+\]\(#brief-transcript-/);
  assert.match(markdown, /<a id="brief-library-/);
  assert.match(html, /Next-call prep brief/);
  assert.match(html, /Open gaps by stakeholder/);
  assert.match(html, /href="#brief-transcript-/);
  assert.match(html, /href="#brief-library-/);
});

test('deal brief keeps historical commercial and open questions after a later technical-only follow-up', () => {
  const baseResult = {
    summary: { dealName: 'Acme', oneLiner: 'Synthetic regression test' },
    pains: [],
    objections: [],
    competitors: [],
    actions: [],
    followupEmail: { subject: '', body: '' },
    demoPrep: [],
    rfpRows: [],
    crmFields: { EconomicBuyer: 'Lena' },
    dealHealth: { score: 0, dimensions: [] },
    risks: [],
    nextBestActions: [],
    battlecards: [],
  };

  let deal = createThreadRecord(
    { title: 'Acme renewal', account: 'Acme' },
    { now: () => '2026-06-18T15:00:00.000Z' },
  );
  deal = appendCallToThread(deal, {
    transcript: [
      '[00:00] Lena (CFO, Acme): Before procurement starts, I need ROI proof and the pricing package.',
      '[00:15] Raj (Security Lead, Acme): Can you confirm whether onboarding support is included in the pilot?',
    ].join('\n'),
    label: 'Discovery call',
    meta: { engine: 'deterministic', durationMs: 3 },
    result: {
      ...baseResult,
      stakeholders: [
        { name: 'Lena', role: 'CFO', evidence: { quote: 'Before procurement starts, I need ROI proof and the pricing package.', line: 1, speaker: 'Lena', ts: '00:00' } },
        { name: 'Raj', role: 'Security Lead', evidence: { quote: 'Can you confirm whether onboarding support is included in the pilot?', line: 2, speaker: 'Raj', ts: '00:15' } },
      ],
      requirements: [
        { category: 'commercial', text: 'Need ROI proof and the pricing package before procurement starts', evidence: { quote: 'Before procurement starts, I need ROI proof and the pricing package.', line: 1, speaker: 'Lena', ts: '00:00' } },
        { category: 'open_question', text: 'Can you confirm whether onboarding support is included in the pilot?', evidence: { quote: 'Can you confirm whether onboarding support is included in the pilot?', line: 2, speaker: 'Raj', ts: '00:15' } },
      ],
      analytics: { speakers: [{ name: 'Lena', role: 'CFO', turns: 1 }, { name: 'Raj', role: 'Security Lead', turns: 1 }], note: '' },
    },
  }, { now: () => '2026-06-18T15:05:00.000Z' });
  deal = appendCallToThread(deal, {
    transcript: '[00:00] Pat (VP Engineering, Acme): The POC needs BigQuery write-back live before we sign off.',
    label: 'Technical follow-up',
    meta: { engine: 'deterministic', durationMs: 3 },
    result: {
      ...baseResult,
      stakeholders: [
        { name: 'Pat', role: 'VP Engineering', evidence: { quote: 'The POC needs BigQuery write-back live before we sign off.', line: 1, speaker: 'Pat', ts: '00:00' } },
      ],
      requirements: [
        { category: 'integration', text: 'Need BigQuery write-back live before sign-off', evidence: { quote: 'The POC needs BigQuery write-back live before we sign off.', line: 1, speaker: 'Pat', ts: '00:00' } },
      ],
      analytics: { speakers: [{ name: 'Pat', role: 'VP Engineering', turns: 1 }], note: '' },
    },
  }, { now: () => '2026-06-20T16:15:00.000Z' });

  const brief = buildDealBrief({ deal, generatedAt: '2026-06-20T16:30:00.000Z' });
  const lenaGaps = brief.stakeholderGaps.find((group) => group.name === 'Lena');
  const rajGaps = brief.stakeholderGaps.find((group) => group.name === 'Raj');

  assert.ok(lenaGaps, 'historical commercial blocker should survive the technical follow-up');
  assert.ok(lenaGaps.items.some((item) => item.category === 'commercial' && /ROI proof and the pricing package/i.test(item.title)));
  assert.ok(rajGaps, 'historical open question should survive the technical follow-up');
  assert.ok(rajGaps.items.some((item) => item.category === 'open_question' && /onboarding support/i.test(item.title)));
  assert.ok(brief.nextQuestions.some((item) => /pricing package and ROI proof/i.test(item.question) && /Discovery call/.test(item.transcriptEvidence?.label || '')));
  assert.ok(brief.nextQuestions.some((item) => /lock the next step/i.test(item.question) && /Discovery call/.test(item.transcriptEvidence?.label || '')));
});
