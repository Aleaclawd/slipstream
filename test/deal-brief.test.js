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

test('deal brief dedupes repeated historical blockers and keeps the newest citation', () => {
  const baseResult = {
    summary: { dealName: 'Acme', oneLiner: 'Synthetic repeated blocker regression test' },
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
    transcript: '[00:00] Lena (CFO, Acme): Before procurement starts, I need ROI proof and the pricing package.',
    label: 'Discovery call',
    meta: { engine: 'deterministic', durationMs: 3 },
    result: {
      ...baseResult,
      stakeholders: [
        { name: 'Lena', role: 'CFO', evidence: { quote: 'Before procurement starts, I need ROI proof and the pricing package.', line: 1, speaker: 'Lena', ts: '00:00' } },
      ],
      requirements: [
        { category: 'commercial', text: 'Need ROI proof and the pricing package before procurement starts', evidence: { quote: 'Before procurement starts, I need ROI proof and the pricing package.', line: 1, speaker: 'Lena', ts: '00:00' } },
      ],
      analytics: { speakers: [{ name: 'Lena', role: 'CFO', turns: 1 }], note: '' },
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
  deal = appendCallToThread(deal, {
    transcript: '[00:00] Lena (CFO, Acme): Before legal can open procurement, I need the commercial justification deck and exact pricing.',
    label: 'Commercial restatement',
    meta: { engine: 'deterministic', durationMs: 3 },
    result: {
      ...baseResult,
      stakeholders: [
        { name: 'Lena', role: 'CFO', evidence: { quote: 'Before legal can open procurement, I need the commercial justification deck and exact pricing.', line: 1, speaker: 'Lena', ts: '00:00' } },
      ],
      requirements: [
        { category: 'commercial', text: 'Need the commercial justification deck and exact pricing before legal can open procurement', evidence: { quote: 'Before legal can open procurement, I need the commercial justification deck and exact pricing.', line: 1, speaker: 'Lena', ts: '00:00' } },
      ],
      analytics: { speakers: [{ name: 'Lena', role: 'CFO', turns: 1 }], note: '' },
    },
  }, { now: () => '2026-06-22T10:00:00.000Z' });

  const brief = buildDealBrief({ deal, generatedAt: '2026-06-22T10:30:00.000Z' });
  const lenaGaps = brief.stakeholderGaps.find((group) => group.name === 'Lena');
  const lenaCommercialItems = lenaGaps?.items.filter((item) => item.category === 'commercial') || [];

  assert.equal(lenaCommercialItems.length, 1, 'same stakeholder blocker should collapse to one commercial gap');
  assert.match(lenaCommercialItems[0]?.title || '', /commercial justification deck and exact pricing/i);
  assert.equal(lenaCommercialItems[0]?.transcriptEvidence?.callLabel, 'Commercial restatement');
});

test('deal brief dedupes repeated historical blocker restatements and keeps the freshest citation', () => {
  const baseResult = {
    summary: { dealName: 'Acme', oneLiner: 'Synthetic repeated blocker regression' },
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
    transcript: '[00:00] Lena (CFO, Acme): Before procurement starts, I need ROI proof and the pricing package.',
    label: 'Call 1',
    meta: { engine: 'deterministic', durationMs: 3 },
    result: {
      ...baseResult,
      stakeholders: [
        { name: 'Lena', role: 'CFO', evidence: { quote: 'Before procurement starts, I need ROI proof and the pricing package.', line: 1, speaker: 'Lena', ts: '00:00' } },
      ],
      requirements: [
        { category: 'commercial', text: 'Need ROI proof and the pricing package before procurement starts', evidence: { quote: 'Before procurement starts, I need ROI proof and the pricing package.', line: 1, speaker: 'Lena', ts: '00:00' } },
      ],
      analytics: { speakers: [{ name: 'Lena', role: 'CFO', turns: 1 }], note: '' },
    },
  }, { now: () => '2026-06-18T15:05:00.000Z' });
  deal = appendCallToThread(deal, {
    transcript: '[00:00] Pat (VP Engineering, Acme): The POC needs BigQuery write-back live before we sign off.',
    label: 'Call 2',
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
  }, { now: () => '2026-06-19T15:05:00.000Z' });
  deal = appendCallToThread(deal, {
    transcript: '[00:00] Lena (CFO, Acme): I need the pricing package and ROI proof before legal approves.',
    label: 'Call 3',
    meta: { engine: 'deterministic', durationMs: 3 },
    result: {
      ...baseResult,
      stakeholders: [
        { name: 'Lena', role: 'CFO', evidence: { quote: 'I need the pricing package and ROI proof before legal approves.', line: 1, speaker: 'Lena', ts: '00:00' } },
      ],
      requirements: [
        { category: 'commercial', text: 'Need the pricing package and ROI proof before legal approves', evidence: { quote: 'I need the pricing package and ROI proof before legal approves.', line: 1, speaker: 'Lena', ts: '00:00' } },
      ],
      analytics: { speakers: [{ name: 'Lena', role: 'CFO', turns: 1 }], note: '' },
    },
  }, { now: () => '2026-06-20T15:05:00.000Z' });

  const brief = buildDealBrief({ deal, generatedAt: '2026-06-20T16:30:00.000Z' });
  const lenaGaps = brief.stakeholderGaps.find((group) => group.name === 'Lena');
  const lenaQuestions = brief.nextQuestions.filter((item) => item.stakeholder === 'Lena');

  assert.ok(lenaGaps, 'repeated blocker should still be present for Lena');
  assert.equal(lenaGaps.items.length, 1, 'repeated blocker should collapse to one stakeholder gap item');
  assert.match(lenaGaps.items[0].title, /pricing package and roi proof/i);
  assert.equal(lenaGaps.items[0].transcriptEvidence?.label, 'Call 3 · line 1');
  assert.equal(lenaQuestions.length, 1, 'repeated blocker should only yield one next question');
  assert.equal(lenaQuestions[0].transcriptEvidence?.label, 'Call 3 · line 1');
  assert.ok(!brief.recentChanges.some((item) => /pricing package and roi proof/i.test(item.title)), 'restated blocker should not be treated as a net-new change');
});

test('deal brief keeps distinct commercial blockers that only share pricing and procurement context', () => {
  const baseResult = {
    summary: { dealName: 'Acme', oneLiner: 'Synthetic distinct commercial blocker regression' },
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
    transcript: '[00:00] Lena (CFO, Acme): Before procurement starts, I need pricing package and ROI proof.',
    label: 'Call 1',
    meta: { engine: 'deterministic', durationMs: 3 },
    result: {
      ...baseResult,
      stakeholders: [
        { name: 'Lena', role: 'CFO', evidence: { quote: 'Before procurement starts, I need pricing package and ROI proof.', line: 1, speaker: 'Lena', ts: '00:00' } },
      ],
      requirements: [
        { category: 'commercial', text: 'Need pricing package and ROI proof before procurement starts', evidence: { quote: 'Before procurement starts, I need pricing package and ROI proof.', line: 1, speaker: 'Lena', ts: '00:00' } },
      ],
      analytics: { speakers: [{ name: 'Lena', role: 'CFO', turns: 1 }], note: '' },
    },
  }, { now: () => '2026-06-18T15:05:00.000Z' });
  deal = appendCallToThread(deal, {
    transcript: '[00:00] Lena (CFO, Acme): Before procurement starts, I need pricing redlines and legal terms.',
    label: 'Call 2',
    meta: { engine: 'deterministic', durationMs: 3 },
    result: {
      ...baseResult,
      stakeholders: [
        { name: 'Lena', role: 'CFO', evidence: { quote: 'Before procurement starts, I need pricing redlines and legal terms.', line: 1, speaker: 'Lena', ts: '00:00' } },
      ],
      requirements: [
        { category: 'commercial', text: 'Need pricing redlines and legal terms before procurement starts', evidence: { quote: 'Before procurement starts, I need pricing redlines and legal terms.', line: 1, speaker: 'Lena', ts: '00:00' } },
      ],
      analytics: { speakers: [{ name: 'Lena', role: 'CFO', turns: 1 }], note: '' },
    },
  }, { now: () => '2026-06-20T15:05:00.000Z' });

  const brief = buildDealBrief({ deal, generatedAt: '2026-06-20T16:30:00.000Z' });
  const lenaGaps = brief.stakeholderGaps.find((group) => group.name === 'Lena');
  const lenaCommercialItems = lenaGaps?.items.filter((item) => item.category === 'commercial') || [];

  assert.equal(lenaCommercialItems.length, 2, 'distinct commercial blockers should both remain visible');
  assert.ok(lenaCommercialItems.some((item) => /pricing package and roi proof/i.test(item.title)));
  assert.ok(lenaCommercialItems.some((item) => /pricing redlines and legal terms/i.test(item.title)));
});

test('deal brief keeps one-token commercial expansions in recent changes', () => {
  const baseResult = {
    summary: { dealName: 'Acme', oneLiner: 'Synthetic recent commercial change regression' },
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
    transcript: '[00:00] Lena (CFO, Acme): Before procurement starts, I need the pricing package.',
    label: 'Call 1',
    meta: { engine: 'deterministic', durationMs: 3 },
    result: {
      ...baseResult,
      stakeholders: [
        { name: 'Lena', role: 'CFO', evidence: { quote: 'Before procurement starts, I need the pricing package.', line: 1, speaker: 'Lena', ts: '00:00' } },
      ],
      requirements: [
        { category: 'commercial', text: 'Need pricing package before procurement starts', evidence: { quote: 'Before procurement starts, I need the pricing package.', line: 1, speaker: 'Lena', ts: '00:00' } },
      ],
      analytics: { speakers: [{ name: 'Lena', role: 'CFO', turns: 1 }], note: '' },
    },
  }, { now: () => '2026-06-18T15:05:00.000Z' });
  deal = appendCallToThread(deal, {
    transcript: '[00:00] Lena (CFO, Acme): Before procurement starts, I need the pricing package discount.',
    label: 'Call 2',
    meta: { engine: 'deterministic', durationMs: 3 },
    result: {
      ...baseResult,
      stakeholders: [
        { name: 'Lena', role: 'CFO', evidence: { quote: 'Before procurement starts, I need the pricing package discount.', line: 1, speaker: 'Lena', ts: '00:00' } },
      ],
      requirements: [
        { category: 'commercial', text: 'Need pricing package discount before procurement starts', evidence: { quote: 'Before procurement starts, I need the pricing package discount.', line: 1, speaker: 'Lena', ts: '00:00' } },
      ],
      analytics: { speakers: [{ name: 'Lena', role: 'CFO', turns: 1 }], note: '' },
    },
  }, { now: () => '2026-06-20T15:05:00.000Z' });

  const brief = buildDealBrief({ deal, generatedAt: '2026-06-20T16:30:00.000Z' });

  assert.ok(brief.recentChanges.some((item) => /pricing package discount/i.test(item.title)), 'latest one-token expansion should remain a visible change');
});
