import { aggregateThreadResult } from './threads.js';

const PRIORITY_ORDER = { P1: 0, P2: 1, P3: 2 };

function escHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
  }[char]));
}

function escAttr(value) {
  return escHtml(value).replace(/'/g, '&#39;');
}

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value) {
  return String(value || 'item')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'item';
}

function textOrFallback(value, fallback = '') {
  const next = String(value || '').trim();
  return next || fallback;
}

function singleLine(value) {
  return textOrFallback(value).replace(/\s+/g, ' ').trim();
}

function isoLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().replace('.000Z', 'Z');
}

function transcriptAnchorId(callId, line) {
  return `brief-transcript-${slugify(callId)}-line-${line}`;
}

function libraryAnchorId(passageId) {
  return `brief-library-${slugify(passageId)}`;
}

function splitTranscriptLines(transcript) {
  return String(transcript || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((text, index) => ({ line: index + 1, text }));
}

function quoteLabel(evidence) {
  if (!evidence?.quote) return '';
  return `line ${evidence.line}: ${String(evidence.quote).trim()}`;
}

function libraryLabel(evidence) {
  if (!evidence?.quote) return '';
  return `${evidence.docName} · ${evidence.heading} · line ${evidence.line}`;
}

function decorateTranscriptEvidence(evidence, callsById) {
  if (!evidence?.quote) return null;
  const call = callsById.get(evidence.callId) || null;
  const line = Number(evidence.line) || null;
  const callLabel = textOrFallback(evidence.callLabel, call?.label || 'Saved call');
  const anchorId = evidence.callId && line ? transcriptAnchorId(evidence.callId, line) : null;
  return {
    ...evidence,
    callLabel,
    speaker: textOrFallback(evidence.speaker),
    line,
    quote: String(evidence.quote).trim(),
    callAt: evidence.callAt || call?.createdAt || null,
    anchorId,
    href: anchorId ? `#${anchorId}` : null,
    label: `${callLabel} · line ${line || '?'}`,
  };
}

function decorateLibraryEvidence(evidence, libraryIndex) {
  if (!evidence?.quote) return null;
  const passage = libraryIndex?.passagesById?.[evidence.passageId] || null;
  const passageId = evidence.passageId || passage?.passageId || `${evidence.docId || 'library'}:${evidence.line || 0}`;
  const anchorId = libraryAnchorId(passageId);
  return {
    ...passage,
    ...evidence,
    docName: textOrFallback(evidence.docName, passage?.docName || 'Library document'),
    heading: textOrFallback(evidence.heading, passage?.heading || 'Section'),
    line: Number(evidence.line) || passage?.line || null,
    quote: textOrFallback(evidence.quote, passage?.text || ''),
    passageId,
    anchorId,
    href: `#${anchorId}`,
    label: libraryLabel({ ...passage, ...evidence }),
  };
}

function dedupeBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (!item) continue;
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function chooseTopAction(result, callsById) {
  const explicit = (result.actions || []).map((item) => ({
    kind: 'call_commitment',
    priority: item.priority || 'P2',
    title: item.title,
    detail: [item.owner, item.due ? `due ${item.due}` : null].filter(Boolean).join(' · '),
    evidence: decorateTranscriptEvidence(item.evidence, callsById),
  }));
  const suggested = (result.nextBestActions || []).map((item) => ({
    kind: 'ai_recommendation',
    priority: item.priority || 'P2',
    title: item.action,
    detail: item.rationale || '',
    evidence: decorateTranscriptEvidence(item.evidence, callsById),
  }));

  return [...explicit, ...suggested]
    .filter((item) => textOrFallback(item.title))
    .sort((left, right) => {
      const priorityGap = (PRIORITY_ORDER[left.priority] ?? 9) - (PRIORITY_ORDER[right.priority] ?? 9);
      if (priorityGap) return priorityGap;
      if (left.kind !== right.kind) return left.kind === 'call_commitment' ? -1 : 1;
      if (left.evidence && !right.evidence) return -1;
      if (!left.evidence && right.evidence) return 1;
      return 0;
    })[0] || null;
}

function stakeholderBadges(name, crmFields) {
  const badges = [];
  if (name && name === crmFields?.Champion) badges.push('Champion');
  if (name && name === crmFields?.EconomicBuyer) badges.push('Economic Buyer');
  return badges;
}

function buildTranscriptAppendix(deal) {
  return (deal.calls || []).map((call, index) => ({
    callId: call.id,
    callLabel: textOrFallback(call.label, `Call ${index + 1}`),
    createdAt: call.createdAt || null,
    lines: splitTranscriptLines(call.transcript).map((entry) => ({
      ...entry,
      anchorId: transcriptAnchorId(call.id, entry.line),
    })),
  }));
}

function buildLibraryCitationMap(verifiedRequirements) {
  const citations = new Map();
  for (const requirement of verifiedRequirements) {
    if (!requirement.libraryEvidence) continue;
    const key = requirement.libraryEvidence.passageId;
    const current = citations.get(key) || {
      ...requirement.libraryEvidence,
      usedBy: [],
    };
    current.usedBy.push(requirement.question);
    citations.set(key, current);
  }
  return [...citations.values()];
}

function gapReason(row) {
  if (row.answerSource === 'none') return 'No supporting library passage yet.';
  if (row.answerSource === 'library' && row.libraryEvidence) return 'Library-grounded answer still needs a human confirmation pass.';
  return 'Captured on the call, but still not verified as ready to send.';
}

function renderCitationLinks({ transcript = null, library = null }) {
  const links = [
    transcript?.href ? `<a href="${escAttr(transcript.href)}">${escHtml(transcript.label)}</a>` : '',
    library?.href ? `<a href="${escAttr(library.href)}">${escHtml(library.label)}</a>` : '',
  ].filter(Boolean);
  return links.length ? `<div class="brief-citations">${links.join('')}</div>` : '';
}

function renderBulletList(items, renderItem, emptyCopy) {
  if (!items.length) return `<div class="brief-empty">${escHtml(emptyCopy)}</div>`;
  return `<ul class="brief-list">${items.map((item) => `<li>${renderItem(item)}</li>`).join('')}</ul>`;
}

function renderSection(title, content) {
  return `<section class="brief-section"><h3>${escHtml(title)}</h3>${content}</section>`;
}

function markdownList(items) {
  return items.filter(Boolean).map((line) => `- ${line}`).join('\n');
}

function markdownTranscriptRef(evidence) {
  if (!evidence?.href) return '';
  return `[${evidence.label}](${evidence.href})`;
}

function markdownLibraryRef(evidence) {
  if (!evidence?.href) return '';
  return `[${evidence.label}](${evidence.href})`;
}

export function buildDealBrief({ deal, view = null, libraryIndex = null, generatedAt = new Date().toISOString() }) {
  if (!deal) throw new Error('deal is required');
  const aggregate = view?.result || aggregateThreadResult(deal);
  const calls = Array.isArray(deal.calls) ? deal.calls : [];
  const callsById = new Map(calls.map((call, index) => [call.id, { ...call, label: textOrFallback(call.label, `Call ${index + 1}`) }]));
  const speakerTurns = new Map(
    (aggregate.analytics?.speakers || []).map((speaker) => [
      `${normalizeKey(speaker.name)}|${normalizeKey(speaker.role)}`,
      Number(speaker.turns) || 0,
    ]),
  );

  const stakeholders = (aggregate.stakeholders || [])
    .map((item) => ({
      name: item.name,
      role: item.role,
      turns: speakerTurns.get(`${normalizeKey(item.name)}|${normalizeKey(item.role)}`) || 0,
      badges: stakeholderBadges(item.name, aggregate.crmFields),
      evidence: decorateTranscriptEvidence(item.evidence, callsById),
    }))
    .sort((left, right) => {
      const badgeGap = right.badges.length - left.badges.length;
      if (badgeGap) return badgeGap;
      return right.turns - left.turns;
    });

  const pains = (aggregate.pains || []).map((item) => ({
    text: item.text,
    severity: item.severity || 'med',
    evidence: decorateTranscriptEvidence(item.evidence, callsById),
  }));

  const verifiedRequirements = (aggregate.rfpRows || [])
    .filter((row) => row.status === 'verified')
    .map((row) => ({
      question: row.question,
      answer: row.suggestedAnswer,
      answerSource: row.answerSource,
      transcriptEvidence: decorateTranscriptEvidence(row.evidence, callsById),
      libraryEvidence: decorateLibraryEvidence(row.libraryEvidence, libraryIndex),
    }));

  const openGaps = (aggregate.rfpRows || [])
    .filter((row) => row.status !== 'verified')
    .map((row) => ({
      question: row.question,
      answer: row.suggestedAnswer,
      answerSource: row.answerSource,
      note: gapReason(row),
      transcriptEvidence: decorateTranscriptEvidence(row.evidence, callsById),
      libraryEvidence: decorateLibraryEvidence(row.libraryEvidence, libraryIndex),
    }));

  const risks = (aggregate.risks || []).map((risk) => ({
    text: risk.text,
    severity: risk.severity || 'med',
    evidence: decorateTranscriptEvidence(risk.evidence, callsById),
  }));

  const topAction = chooseTopAction(aggregate, callsById);
  const libraryCitations = buildLibraryCitationMap(verifiedRequirements);
  const transcriptAppendix = buildTranscriptAppendix(deal);
  const libraryAppendix = dedupeBy(libraryCitations, (item) => item.passageId);

  return {
    dealId: deal.id,
    title: deal.title,
    account: deal.account || aggregate.crmFields?.Account || '',
    oneLiner: aggregate.summary?.oneLiner || '',
    callCount: calls.length,
    generatedAt,
    updatedAt: deal.updatedAt || null,
    champion: aggregate.crmFields?.Champion || '',
    economicBuyer: aggregate.crmFields?.EconomicBuyer || '',
    topAction,
    stakeholders,
    pains,
    verifiedRequirements,
    openGaps,
    libraryCitations,
    risks,
    transcriptAppendix,
    libraryAppendix,
  };
}

export function renderDealBriefPacket(brief) {
  const transcriptCount = brief.transcriptAppendix.reduce((count, call) => count + call.lines.length, 0);
  const headingMeta = [
    `${brief.callCount} saved call${brief.callCount === 1 ? '' : 's'}`,
    brief.account ? `account: ${brief.account}` : '',
    brief.updatedAt ? `updated ${isoLabel(brief.updatedAt)}` : '',
  ].filter(Boolean).join(' · ');

  const topActionHtml = brief.topAction
    ? `<div class="brief-hero-card">
        <div class="brief-kicker">Prioritized next action</div>
        <h2>${escHtml(brief.topAction.title)}</h2>
        <p>${escHtml(brief.topAction.detail || 'Grounded from the saved deal workspace.')}</p>
        ${renderCitationLinks({ transcript: brief.topAction.evidence })}
      </div>`
    : `<div class="brief-hero-card">
        <div class="brief-kicker">Prioritized next action</div>
        <h2>No next action captured yet</h2>
        <p>Add another call or ground more requirements to produce a champion-ready brief.</p>
      </div>`;

  const stakeholderHtml = renderBulletList(
    brief.stakeholders,
    (item) => {
      const badges = item.badges.length
        ? `<span class="brief-badges">${item.badges.map((badge) => `<span class="brief-badge">${escHtml(badge)}</span>`).join('')}</span>`
        : '';
      return `<div class="brief-item-head"><strong>${escHtml(item.name)}</strong>${badges}</div>
        <div class="brief-item-copy">${escHtml(item.role || 'Role not captured')}${item.turns ? ` · ${escHtml(item.turns)} turns` : ''}</div>
        ${renderCitationLinks({ transcript: item.evidence })}`;
    },
    'No stakeholders captured yet.',
  );

  const painsHtml = renderBulletList(
    brief.pains,
    (item) => `<div class="brief-item-head"><strong>${escHtml(item.text)}</strong></div>
      <div class="brief-item-copy">Severity: ${escHtml(item.severity)}</div>
      ${renderCitationLinks({ transcript: item.evidence })}`,
    'No pains captured yet.',
  );

  const verifiedHtml = renderBulletList(
    brief.verifiedRequirements,
    (item) => `<div class="brief-item-head"><strong>${escHtml(item.question)}</strong></div>
      <div class="brief-item-copy">${escHtml(item.answer)}</div>
      ${renderCitationLinks({ transcript: item.transcriptEvidence, library: item.libraryEvidence })}`,
    'No verified requirements yet.',
  );

  const libraryHtml = renderBulletList(
    brief.libraryCitations,
    (item) => `<div class="brief-item-head"><strong>${escHtml(item.docName)}</strong> · ${escHtml(item.heading)}</div>
      <div class="brief-item-copy">${escHtml(item.quote)}</div>
      <div class="brief-item-copy">Used by ${escHtml(item.usedBy.length)} requirement${item.usedBy.length === 1 ? '' : 's'}.</div>
      ${renderCitationLinks({ library: item })}`,
    'No library-grounded passages cited yet.',
  );

  const gapsHtml = renderBulletList(
    brief.openGaps,
    (item) => `<div class="brief-item-head"><strong>${escHtml(item.question)}</strong></div>
      <div class="brief-item-copy">${escHtml(item.note)}</div>
      <div class="brief-item-copy">${escHtml(item.answer)}</div>
      ${renderCitationLinks({ transcript: item.transcriptEvidence, library: item.libraryEvidence })}`,
    'No open gaps.',
  );

  const risksHtml = renderBulletList(
    brief.risks,
    (item) => `<div class="brief-item-head"><strong>${escHtml(item.text)}</strong></div>
      <div class="brief-item-copy">Severity: ${escHtml(item.severity)}</div>
      ${renderCitationLinks({ transcript: item.evidence })}`,
    'No risks flagged.',
  );

  const transcriptHtml = brief.transcriptAppendix.map((call) => `<details class="brief-appendix" open>
      <summary>${escHtml(call.callLabel)} · ${escHtml(call.lines.length)} line${call.lines.length === 1 ? '' : 's'}</summary>
      <ol>
        ${call.lines.map((line) => `<li id="${escAttr(line.anchorId)}"><span class="brief-line-no">line ${escHtml(line.line)}</span>${escHtml(line.text || ' ')}</li>`).join('')}
      </ol>
    </details>`).join('');

  const libraryAppendixHtml = brief.libraryAppendix.map((item) => `<article class="brief-appendix-card" id="${escAttr(item.anchorId)}">
      <h4>${escHtml(item.docName)} · ${escHtml(item.heading)}</h4>
      <div class="brief-item-copy">line ${escHtml(item.line)} · passage ${escHtml(item.passageId)}</div>
      <pre>${escHtml(item.quote)}</pre>
    </article>`).join('');

  return `<div class="brief-packet">
    <section class="brief-hero">
      <div>
        <div class="brief-kicker">Champion evidence packet</div>
        <h1>${escHtml(brief.title || 'Saved deal brief')}</h1>
        <p>${escHtml(brief.oneLiner || 'Local saved deal workspace summary.')}</p>
        <div class="brief-meta">${escHtml(headingMeta)}</div>
      </div>
      ${topActionHtml}
    </section>

    <div class="brief-grid">
      ${renderSection('Key stakeholders', stakeholderHtml)}
      ${renderSection('Pains', painsHtml)}
      ${renderSection('Verified requirements', verifiedHtml)}
      ${renderSection('Library citations', libraryHtml)}
      ${renderSection('Open gaps', gapsHtml)}
      ${renderSection('Risk notes', risksHtml)}
    </div>

    <section class="brief-section">
      <h3>Transcript appendix</h3>
      <div class="brief-item-copy">${escHtml(transcriptCount)} local transcript line${transcriptCount === 1 ? '' : 's'} available for citation grounding.</div>
      ${transcriptHtml}
    </section>

    <section class="brief-section">
      <h3>Library appendix</h3>
      ${libraryAppendixHtml || '<div class="brief-empty">No cited library passages yet.</div>'}
    </section>
  </div>`;
}

export function renderDealBriefHtml(brief) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escHtml(brief.title || 'Slipstream deal brief')}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0b1118;
        --panel: #131d2a;
        --panel-2: #18242f;
        --line: #233042;
        --ink: #e8eef6;
        --muted: #8aa0b6;
        --accent: #2ee6c4;
        --accent-2: #4aa8ff;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 32px;
        background: radial-gradient(1000px 600px at 80% -10%, #16314a33, transparent 60%), var(--bg);
        color: var(--ink);
        font: 15px/1.6 Inter, "Segoe UI", sans-serif;
      }
      a { color: var(--accent-2); text-decoration: none; }
      a:hover { text-decoration: underline; }
      .brief-packet { max-width: 1180px; margin: 0 auto; }
      .brief-hero { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 18px; align-items: stretch; }
      .brief-hero-card,
      .brief-section,
      .brief-appendix-card {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 16px;
        padding: 18px 20px;
      }
      .brief-kicker,
      .brief-section h3 {
        margin: 0 0 8px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: 12px;
        color: var(--muted);
      }
      h1, h2, h4 { margin: 0; }
      .brief-meta,
      .brief-item-copy { color: var(--muted); font-size: 13px; }
      .brief-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 18px; }
      .brief-list { list-style: none; padding: 0; margin: 0; display: grid; gap: 12px; }
      .brief-list li { padding-bottom: 12px; border-bottom: 1px dashed var(--line); }
      .brief-list li:last-child { border-bottom: none; padding-bottom: 0; }
      .brief-item-head { display: flex; gap: 8px; flex-wrap: wrap; align-items: baseline; }
      .brief-badges { display: inline-flex; gap: 6px; flex-wrap: wrap; }
      .brief-badge {
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid #1f5a4f;
        color: var(--accent);
        font: 600 11px/1.4 "JetBrains Mono", monospace;
      }
      .brief-citations { margin-top: 6px; display: flex; gap: 10px; flex-wrap: wrap; font: 600 12px/1.4 "JetBrains Mono", monospace; }
      .brief-empty { color: var(--muted); }
      .brief-appendix { margin-top: 12px; background: var(--panel-2); border-radius: 12px; padding: 12px 14px; }
      .brief-appendix summary { cursor: pointer; font-weight: 700; }
      .brief-appendix ol { margin: 12px 0 0; padding-left: 20px; }
      .brief-appendix li { margin-bottom: 6px; font: 400 13px/1.6 "JetBrains Mono", monospace; }
      .brief-line-no { display: inline-block; min-width: 74px; color: var(--accent); }
      pre {
        margin: 12px 0 0;
        white-space: pre-wrap;
        font: 400 13px/1.6 "JetBrains Mono", monospace;
      }
      @media (max-width: 900px) {
        body { padding: 18px; }
        .brief-hero,
        .brief-grid { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>${renderDealBriefPacket(brief)}</body>
</html>`;
}

export function renderDealBriefMarkdown(brief) {
  const lines = [
    `# ${brief.title || 'Saved deal brief'}`,
    '',
    brief.oneLiner || 'Local saved deal workspace summary.',
    '',
    markdownList([
      `${brief.callCount} saved call${brief.callCount === 1 ? '' : 's'}`,
      brief.account ? `Account: ${brief.account}` : '',
      brief.updatedAt ? `Updated: ${isoLabel(brief.updatedAt)}` : '',
      `Generated: ${isoLabel(brief.generatedAt)}`,
    ]),
    '',
    '## Prioritized next action',
    '',
  ];

  if (brief.topAction) {
    lines.push(`- ${brief.topAction.priority}: ${brief.topAction.title}`);
    if (brief.topAction.detail) lines.push(`- Why now: ${brief.topAction.detail}`);
    if (brief.topAction.evidence) lines.push(`- Citation: ${markdownTranscriptRef(brief.topAction.evidence)}`);
  } else {
    lines.push('- No prioritized action captured yet.');
  }

  lines.push('', '## Key stakeholders', '');
  lines.push(brief.stakeholders.length
    ? markdownList(brief.stakeholders.map((item) => {
      const badges = item.badges.length ? ` [${item.badges.join(', ')}]` : '';
      const turns = item.turns ? ` · ${item.turns} turns` : '';
      const citation = item.evidence ? ` · ${markdownTranscriptRef(item.evidence)}` : '';
      return `**${item.name}**${badges} — ${item.role || 'Role not captured'}${turns}${citation}`;
    }))
    : '- No stakeholders captured yet.');

  lines.push('', '## Pains', '');
  lines.push(brief.pains.length
    ? markdownList(brief.pains.map((item) => `**${item.text}** · severity ${item.severity}${item.evidence ? ` · ${markdownTranscriptRef(item.evidence)}` : ''}`))
    : '- No pains captured yet.');

  lines.push('', '## Verified requirements', '');
  lines.push(brief.verifiedRequirements.length
    ? markdownList(brief.verifiedRequirements.map((item) => {
      const refs = [markdownTranscriptRef(item.transcriptEvidence), markdownLibraryRef(item.libraryEvidence)].filter(Boolean).join(' · ');
      return `**${item.question}**\n  - Answer: ${item.answer}\n  - Citations: ${refs || 'none'}`;
    }))
    : '- No verified requirements yet.');

  lines.push('', '## Library citations', '');
  lines.push(brief.libraryCitations.length
    ? markdownList(brief.libraryCitations.map((item) => `**${item.docName} · ${item.heading}** — ${singleLine(item.quote)}\n  - Used by: ${item.usedBy.join('; ')}\n  - Link: ${markdownLibraryRef(item)}`))
    : '- No library-grounded passages cited yet.');

  lines.push('', '## Open gaps', '');
  lines.push(brief.openGaps.length
    ? markdownList(brief.openGaps.map((item) => {
      const refs = [markdownTranscriptRef(item.transcriptEvidence), markdownLibraryRef(item.libraryEvidence)].filter(Boolean).join(' · ');
      return `**${item.question}**\n  - Gap: ${item.note}\n  - Current draft: ${item.answer}\n  - Citations: ${refs || 'none'}`;
    }))
    : '- No open gaps.');

  lines.push('', '## Risk notes', '');
  lines.push(brief.risks.length
    ? markdownList(brief.risks.map((item) => `**${item.text}** · severity ${item.severity}${item.evidence ? ` · ${markdownTranscriptRef(item.evidence)}` : ''}`))
    : '- No risks flagged.');

  lines.push('', '## Transcript appendix', '');
  for (const call of brief.transcriptAppendix) {
    lines.push(`### ${call.callLabel}`);
    lines.push('');
    for (const line of call.lines) {
      lines.push(`<a id="${line.anchorId}"></a>`);
      lines.push(`- Line ${line.line}: ${line.text || ' '}`);
    }
    lines.push('');
  }

  lines.push('## Library appendix', '');
  if (!brief.libraryAppendix.length) {
    lines.push('- No cited library passages yet.');
  } else {
    for (const item of brief.libraryAppendix) {
      lines.push(`### ${item.docName} · ${item.heading}`);
      lines.push('');
      lines.push(`<a id="${item.anchorId}"></a>`);
      lines.push(`- Passage: ${item.passageId}`);
      lines.push(`- Line: ${item.line}`);
      lines.push(`- Quote: ${singleLine(item.quote)}`);
      lines.push('');
    }
  }

  return `${lines.join('\n').trim()}\n`;
}
