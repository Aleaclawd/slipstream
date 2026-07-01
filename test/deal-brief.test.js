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
