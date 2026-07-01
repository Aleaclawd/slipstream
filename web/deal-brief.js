import { aggregateThreadResult } from './threads.js';

const PRIORITY_ORDER = { P1: 0, P2: 1, P3: 2 };
const GAP_CATEGORY_ORDER = { commercial: 0, security: 1, integration: 2, scale: 3, open_question: 4, other: 5 };
const BRIEF_STOP = new Set([
  'the', 'and', 'with', 'need', 'would', 'that', 'this', 'your', 'our', 'their', 'from', 'have',
  'will', 'about', 'into', 'what', 'when', 'where', 'which', 'there', 'they', 'them', 'then', 'than',
  'also', 'some', 'more', 'most', 'very', 'just', 'like', 'make', 'made', 'does', 'done', 'both',
  'each', 'only', 'over', 'must', 'able', 'want', 'take', 'give', 'data', 'call', 'team', 'time',
  'plan', 'help', 'sure', 'okay', 'good', 'great', 'thanks', 'yes', 'are', 'was', 'were', 'has',
  'its', 'for', 'but', 'not', 'all', 'any', 'get', 'can', 'you', 'use', 'via', 'per', 'out', 'now',
  'one', 'two', 'too', 'let', 'see', 'say', 'set', 'run', 'day', 'is', 'meet', 'support', 'state',
  'flag', 'confirm', 'product', 'gap', 'draft', 'please', 'question', 'security', 'compliance', 'we',
  'integration', 'scale', 'performance', 'follow', 'call',
]);
const GAP_TOKEN_STOP = new Set([
  ...BRIEF_STOP,
  'in', 'of', 'before', 'after', 'included', 'including', 'exact', 'open', 'opens', 'start', 'starts',
  'part', 'whether', 'still', 'needs', 'proof', 'answer', 'answers', 'clarity', 'show', 'move', 'forward',
  'included', 'include', 'included', 'help',
]);

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
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value) {
  return (normalizeKey(value).match(/[a-z0-9]+/g) || [])
    .filter((token) => token.length >= 2 && !BRIEF_STOP.has(token));
}

function requirementCore(value) {
  const normalized = singleLine(value)
    .replace(/^(?:before|after|once|when|while|if|until|unless)\b[^,]*,\s*/i, '')
    .replace(/^(?:please\s+confirm:\s*)/i, '')
    .replace(/^(?:can|could|would)\s+you\s+confirm(?:\s+whether)?\s+/i, '')
    .replace(/^(?:i|we)\s+need\s+/i, '')
    .trim();
  const contextualTail = normalized.split(/\b(?:before|after|once|when|while|if|until|unless)\b/i)[0];
  return singleLine(contextualTail || normalized);
}

function requirementIdentity(value) {
  const tokens = [...new Set(tokenize(requirementCore(value)))].sort();
  return tokens.join('|') || normalizeKey(requirementCore(value));
}

function sharedTokenCount(left, right) {
  const rightSet = new Set(tokenize(right));
  let count = 0;
  for (const token of new Set(tokenize(left))) {
    if (rightSet.has(token)) count++;
  }
  return count;
}

function phrasesSimilar(left, right) {
  const a = normalizeKey(left);
  const b = normalizeKey(right);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const overlap = sharedTokenCount(a, b);
  return overlap >= 2;
}

function novelTokenCount(left, right) {
  const rightSet = new Set(tokenize(right));
  return [...new Set(tokenize(left))].filter((token) => !rightSet.has(token)).length;
}

function canonicalGapToken(token, category) {
  if (category === 'commercial') {
    if (/^pric(?:e|ing|ed)?$/.test(token) || token === 'commercial' || token === 'package') return 'pricing';
    if (token === 'roi' || token === 'justification') return 'roi';
    if (token === 'procurement' || token === 'legal' || token === 'contract' || token === 'contracts') return 'procurement';
  }
  if (token === 'poc') return 'pilot';
  return token;
}

function gapRequirementTokens(item) {
  const category = normalizeKey(item?.category);
  const raw = `${item?.title || ''} ${item?.transcriptEvidence?.quote || ''}`;
  const tokens = [];
  const seen = new Set();
  for (const token of normalizeKey(raw).match(/[a-z0-9]+/g) || []) {
    const canonical = canonicalGapToken(token, category);
    if (!canonical || canonical.length < 2 || GAP_TOKEN_STOP.has(canonical) || seen.has(canonical)) continue;
    seen.add(canonical);
    tokens.push(canonical);
  }
  return tokens;
}

function gapRequirementSharedTokenCount(left, right) {
  const rightSet = new Set(gapRequirementTokens(right));
  let count = 0;
  for (const token of gapRequirementTokens(left)) {
    if (rightSet.has(token)) count++;
  }
  return count;
}

function scoreAction(item) {
  let score = 0;
  if (item.owner === 'SE') score += 6;
  if (item.kind === 'call_commitment') score += 4;
  if (item.evidence) score += 2;
  if (/\bdue\b/i.test(item.detail || '')) score += 2;
  if ((item.title || '').length <= 70) score += 1;
  if (/^(today i want to|before we go further|if you can show us)/i.test(item.title || '')) score -= 5;
  return score;
}

function timeValue(value) {
  if (!value) return 0;
  const stamp = Date.parse(value);
  return Number.isNaN(stamp) ? 0 : stamp;
}

function latestEvidenceValue(evidence) {
  return timeValue(evidence?.callAt);
}

function withCallContext(evidence, call, fallbackLabel = 'Saved call') {
  if (!evidence?.quote || !call) return evidence;
  return {
    ...evidence,
    callId: evidence.callId || call.id,
    callLabel: evidence.callLabel || textOrFallback(call.label, fallbackLabel),
    callAt: evidence.callAt || call.createdAt || null,
  };
}

function isSeRole(role) {
  return /\b(?:SE|AE)\b|sales\s+eng(?:ineer)?|solutions?\s+(?:consultant|engineer|architect)|account\s+exec(?:utive)?/i.test(role || '');
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
    owner: item.owner || '',
    priority: item.priority || 'P2',
    title: item.title,
    detail: [item.owner, item.due ? `due ${item.due}` : null].filter(Boolean).join(' · '),
    evidence: decorateTranscriptEvidence(item.evidence, callsById),
  }));
  const suggested = (result.nextBestActions || []).map((item) => ({
    kind: 'ai_recommendation',
    owner: 'AI',
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
      const actionGap = scoreAction(right) - scoreAction(left);
      if (actionGap) return actionGap;
      const freshnessGap = latestEvidenceValue(right.evidence) - latestEvidenceValue(left.evidence);
      if (freshnessGap) return freshnessGap;
      if (left.kind !== right.kind) return left.kind === 'call_commitment' ? -1 : 1;
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

function priorAggregateForDeal(deal) {
  const calls = Array.isArray(deal?.calls) ? deal.calls : [];
  if (calls.length < 2) return null;
  return aggregateThreadResult({
    ...deal,
    calls: calls.slice(0, -1),
    updatedAt: calls[calls.length - 2]?.createdAt || deal.updatedAt,
  });
}

function findStakeholder(stakeholders, name) {
  const target = normalizeKey(name);
  return stakeholders.find((item) => normalizeKey(item.name) === target) || null;
}

function stakeholderGroupMeta(stakeholders, name, role, crmFields) {
  const stakeholder = findStakeholder(stakeholders, name);
  const resolvedName = stakeholder?.name || textOrFallback(name, 'Buying committee');
  const resolvedRole = stakeholder?.role || role || '';
  return {
    name: resolvedName,
    role: resolvedRole,
    badges: stakeholderBadges(resolvedName, crmFields),
  };
}

function inferGapCategory(value) {
  const text = `${value || ''}`;
  if (/security|sso|saml|okta|audit|residency/i.test(text)) return 'security';
  if (/integration|snowflake|bigquery|slack|write-back|write back/i.test(text)) return 'integration';
  if (/scale|performance|latency|throughput|events/i.test(text)) return 'scale';
  if (/budget|pricing|roi|procurement|cfo|commercial/i.test(text)) return 'commercial';
  if (/please confirm|open question|\?/.test(text)) return 'open_question';
  return 'other';
}

function changeHeadlineForRequirement(requirement) {
  switch (requirement.category) {
    case 'security':
      return 'Security review moved forward';
    case 'integration':
      return 'POC scope changed';
    case 'scale':
      return 'Scale bar was clarified';
    case 'commercial':
      return 'Commercial path changed';
    case 'open_question':
      return 'A new open question surfaced';
    default:
      return 'New fact captured on the latest call';
  }
}

function buildRecentChanges({ deal, latestCall, priorAggregate, callsById }) {
  if (!latestCall?.result) return [];
  const latest = latestCall.result;
  const priorStakeholderKeys = new Set(
    (priorAggregate?.stakeholders || [])
      .filter((item) => !isSeRole(item.role))
      .map((item) => `${normalizeKey(item.name)}|${normalizeKey(item.role)}`),
  );
  const priorRequirements = priorAggregate?.requirements || [];
  const changes = [];

  for (const stakeholder of latest.stakeholders || []) {
    if (!stakeholder.name || isSeRole(stakeholder.role)) continue;
    const key = `${normalizeKey(stakeholder.name)}|${normalizeKey(stakeholder.role)}`;
    if (priorStakeholderKeys.has(key)) continue;
    changes.push({
      title: `${stakeholder.name} joined the buying committee`,
      detail: stakeholder.role || 'Role captured on the latest call.',
      badges: ['New stakeholder'],
      evidence: decorateTranscriptEvidence(withCallContext(stakeholder.evidence, latestCall), callsById),
    });
  }

  for (const requirement of latest.requirements || []) {
    const matchesPrior = priorRequirements.some((item) =>
      item.category === requirement.category &&
      (
        requirementIdentity(item.text) === requirementIdentity(requirement.text) ||
        (
          phrasesSimilar(item.text, requirement.text) &&
          novelTokenCount(requirement.text, item.text) < 2
        )
      )
    );
    if (matchesPrior) continue;
    const evidence = decorateTranscriptEvidence(withCallContext(requirement.evidence, latestCall), callsById);
    const speaker = evidence?.speaker || '';
    changes.push({
      title: textOrFallback(requirement.text, requirement.category.replace(/_/g, ' ')),
      detail: speaker
        ? `${changeHeadlineForRequirement(requirement)} · raised by ${speaker}.`
        : changeHeadlineForRequirement(requirement),
      badges: [requirement.category.replace(/_/g, ' ')],
      evidence,
    });
  }

  return dedupeBy(changes, (item) => `${normalizeKey(item.title)}|${normalizeKey(item.detail)}`).slice(0, 6);
}

function requirementGapDetail(category) {
  return category === 'commercial'
    ? 'Commercial approval details still need an exact pricing / ROI close plan.'
    : 'The prospect asked a next-step question that still needs a concrete answer.';
}

function compareStakeholderGapItems(left, right) {
  const freshnessGap = latestEvidenceValue(right.transcriptEvidence) - latestEvidenceValue(left.transcriptEvidence);
  if (freshnessGap) return freshnessGap;
  const categoryGap = (GAP_CATEGORY_ORDER[left.category] ?? 9) - (GAP_CATEGORY_ORDER[right.category] ?? 9);
  if (categoryGap) return categoryGap;
  return normalizeKey(left.title).localeCompare(normalizeKey(right.title));
}

function stakeholderGapItemsMatch(left, right) {
  if (normalizeKey(left.stakeholderName) !== normalizeKey(right.stakeholderName)) return false;
  if (normalizeKey(left.stakeholderRole) !== normalizeKey(right.stakeholderRole)) return false;
  if (normalizeKey(left.category) !== normalizeKey(right.category)) return false;
  if (requirementIdentity(left.title) === requirementIdentity(right.title)) return true;
  if (gapRequirementSharedTokenCount(left, right) >= 2) return true;
  const leftTitle = normalizeKey(left.title);
  const rightTitle = normalizeKey(right.title);
  return Boolean(leftTitle && rightTitle && (
    leftTitle === rightTitle ||
    leftTitle.includes(rightTitle) ||
    rightTitle.includes(leftTitle)
  ));
}

function dedupeStakeholderGapItems(items) {
  const deduped = [];
  for (const item of [...items].sort(compareStakeholderGapItems)) {
    if (deduped.some((candidate) => stakeholderGapItemsMatch(candidate, item))) continue;
    deduped.push(item);
  }
  return deduped;
}

function buildHistoricalRequirementGapItems({ calls, stakeholders, callsById, crmFields }) {
  const items = [];
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index];
    for (const requirement of call?.result?.requirements || []) {
      if (!['commercial', 'open_question'].includes(requirement.category)) continue;
      const transcriptEvidence = decorateTranscriptEvidence(withCallContext(requirement.evidence, call), callsById);
      const group = stakeholderGroupMeta(stakeholders, transcriptEvidence?.speaker || requirement.evidence?.speaker, '', crmFields);
      items.push({
        stakeholderName: group.name,
        stakeholderRole: group.role,
        stakeholderBadges: group.badges,
        category: requirement.category,
        title: requirement.text,
        detail: requirementGapDetail(requirement.category),
        transcriptEvidence,
        libraryEvidence: null,
      });
    }
  }
  return dedupeStakeholderGapItems(items);
}

function buildStakeholderGaps({ aggregate, calls, stakeholders, callsById, libraryIndex }) {
  const items = [];

  for (const row of aggregate.rfpRows || []) {
    if (row.status === 'verified' && row.answerSource === 'call') continue;
    const transcriptEvidence = decorateTranscriptEvidence(row.evidence, callsById);
    const libraryEvidence = decorateLibraryEvidence(row.libraryEvidence, libraryIndex);
    const group = stakeholderGroupMeta(stakeholders, transcriptEvidence?.speaker || row.evidence?.speaker, '', aggregate.crmFields);
    items.push({
      stakeholderName: group.name,
      stakeholderRole: group.role,
      stakeholderBadges: group.badges,
      category: inferGapCategory(row.question),
      title: row.question,
      detail: gapReason(row),
      transcriptEvidence,
      libraryEvidence,
    });
  }

  items.push(...buildHistoricalRequirementGapItems({
    calls,
    stakeholders,
    callsById,
    crmFields: aggregate.crmFields,
  }));

  const groups = new Map();
  for (const item of items) {
    const key = `${normalizeKey(item.stakeholderName)}|${normalizeKey(item.stakeholderRole)}`;
    const current = groups.get(key) || {
      name: item.stakeholderName,
      role: item.stakeholderRole,
      badges: item.stakeholderBadges,
      items: [],
    };
    current.items.push(item);
    groups.set(key, current);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      items: dedupeStakeholderGapItems(group.items),
    }))
    .sort((left, right) => {
      const freshnessGap = latestEvidenceValue(right.items[0]?.transcriptEvidence) - latestEvidenceValue(left.items[0]?.transcriptEvidence);
      if (freshnessGap) return freshnessGap;
      const badgeGap = right.badges.length - left.badges.length;
      if (badgeGap) return badgeGap;
      return normalizeKey(left.name).localeCompare(normalizeKey(right.name));
    });
}

function questionForGap(item, stakeholder) {
  const quote = `${item.transcriptEvidence?.quote || ''} ${item.title || ''}`;
  if (item.category === 'security') {
    return `What still has to be true for ${stakeholder} to sign off on security before the next stage?`;
  }
  if (item.category === 'integration') {
    if (/bigquery/i.test(quote) && /snowflake/i.test(quote)) {
      return 'Does the next POC need Snowflake and BigQuery write-back in one pass, or can BigQuery land right after Snowflake?';
    }
    if (/write[- ]?back/i.test(quote)) {
      return 'Which write-back flow has to work live for you to call the integration proven?';
    }
    return 'Which integration workflow has to work live on the next call for this requirement to be closed?';
  }
  if (item.category === 'scale') {
    return 'What volume and latency threshold will you use to judge the POC as production-ready?';
  }
  if (item.category === 'commercial') {
    if (/pricing|roi|procurement|july/i.test(quote)) {
      return 'What pricing package and ROI proof do you need before procurement can start?';
    }
    return 'What has to be true for budget approval to move forward this quarter?';
  }
  if (item.category === 'open_question') {
    return 'What answer would let us lock the next step before the call ends?';
  }
  return 'What would have to be true on the next call for this gap to be considered closed?';
}

function buildNextQuestions(stakeholderGaps) {
  return stakeholderGaps
    .map((group) => {
      const item = group.items[0];
      if (!item) return null;
      return {
        stakeholder: group.name,
        role: group.role,
        question: questionForGap(item, group.name || 'the stakeholder'),
        detail: item.detail,
        transcriptEvidence: item.transcriptEvidence,
        libraryEvidence: item.libraryEvidence,
      };
    })
    .filter(Boolean)
    .slice(0, 6);
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

function renderStakeholderGapGroups(groups) {
  if (!groups.length) return '<div class="brief-empty">No stakeholder gaps captured yet.</div>';
  return groups.map((group) => {
    const badges = group.badges.length
      ? `<span class="brief-badges">${group.badges.map((badge) => `<span class="brief-badge">${escHtml(badge)}</span>`).join('')}</span>`
      : '';
    const items = group.items.map((item) => `<li>
      <div class="brief-item-head"><strong>${escHtml(item.title)}</strong></div>
      <div class="brief-item-copy">${escHtml(item.detail)}</div>
      ${renderCitationLinks({ transcript: item.transcriptEvidence, library: item.libraryEvidence })}
    </li>`).join('');
    return `<article class="brief-gap-group">
      <div class="brief-item-head"><strong>${escHtml(group.name)}</strong>${badges}</div>
      <div class="brief-item-copy">${escHtml(group.role || 'Stakeholder')}</div>
      <ul class="brief-list">${items}</ul>
    </article>`;
  }).join('');
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
  const latestCall = calls[calls.length - 1] || null;
  const priorAggregate = priorAggregateForDeal(deal);
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
  const recentChanges = buildRecentChanges({ deal, latestCall, priorAggregate, callsById });
  const stakeholderGaps = buildStakeholderGaps({
    aggregate,
    calls,
    stakeholders,
    callsById,
    libraryIndex,
  });
  const nextQuestions = buildNextQuestions(stakeholderGaps);
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
    recentChanges,
    stakeholderGaps,
    nextQuestions,
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
    `generated ${isoLabel(brief.generatedAt)}`,
  ].filter(Boolean).join(' · ');

  const topActionHtml = brief.topAction
    ? `<div class="brief-hero-card">
        <div class="brief-kicker">Prioritized action before the next call</div>
        <h2>${escHtml(brief.topAction.title)}</h2>
        <p>${escHtml(brief.topAction.detail || 'Grounded from the saved deal workspace.')}</p>
        ${renderCitationLinks({ transcript: brief.topAction.evidence })}
      </div>`
    : `<div class="brief-hero-card">
        <div class="brief-kicker">Prioritized action before the next call</div>
        <h2>No next action captured yet</h2>
        <p>Add another call or ground more requirements to produce a champion-ready brief.</p>
      </div>`;

  const recentChangesHtml = renderBulletList(
    brief.recentChanges,
    (item) => {
      const badges = item.badges?.length
        ? `<span class="brief-badges">${item.badges.map((badge) => `<span class="brief-badge">${escHtml(badge)}</span>`).join('')}</span>`
        : '';
      return `<div class="brief-item-head"><strong>${escHtml(item.title)}</strong>${badges}</div>
        <div class="brief-item-copy">${escHtml(item.detail || 'Raised on the latest call.')}</div>
        ${renderCitationLinks({ transcript: item.evidence })}`;
    },
    'No net-new facts since the previous call.',
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

  const risksHtml = renderBulletList(
    brief.risks,
    (item) => `<div class="brief-item-head"><strong>${escHtml(item.text)}</strong></div>
      <div class="brief-item-copy">Severity: ${escHtml(item.severity)}</div>
      ${renderCitationLinks({ transcript: item.evidence })}`,
    'No risks flagged.',
  );

  const questionHtml = renderBulletList(
    brief.nextQuestions,
    (item) => `<div class="brief-item-head"><strong>${escHtml(item.stakeholder)}</strong>${item.role ? ` · ${escHtml(item.role)}` : ''}</div>
      <div class="brief-item-copy">${escHtml(item.question)}</div>
      <div class="brief-item-copy">${escHtml(item.detail)}</div>
      ${renderCitationLinks({ transcript: item.transcriptEvidence, library: item.libraryEvidence })}`,
    'No suggested questions yet.',
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
        <div class="brief-kicker">Next-call prep brief</div>
        <h1>${escHtml(brief.title || 'Saved deal brief')}</h1>
        <p>${escHtml(brief.oneLiner || 'Local saved deal workspace summary.')}</p>
        <div class="brief-meta">${escHtml(headingMeta)}</div>
      </div>
      ${topActionHtml}
    </section>

    <div class="brief-grid">
      ${renderSection('Changed since the prior call', recentChangesHtml)}
      ${renderSection('Open gaps by stakeholder', renderStakeholderGapGroups(brief.stakeholderGaps))}
      ${renderSection('Deal risks', risksHtml)}
      ${renderSection('Suggested next questions', questionHtml)}
      ${renderSection('Verified proof points', verifiedHtml)}
      ${renderSection('Library citations', libraryHtml)}
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
      .brief-gap-group + .brief-gap-group { margin-top: 14px; }
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
    '## Prioritized action before the next call',
    '',
  ];

  if (brief.topAction) {
    lines.push(`- ${brief.topAction.priority}: ${brief.topAction.title}`);
    if (brief.topAction.detail) lines.push(`- Why now: ${brief.topAction.detail}`);
    if (brief.topAction.evidence) lines.push(`- Citation: ${markdownTranscriptRef(brief.topAction.evidence)}`);
  } else {
    lines.push('- No prioritized action captured yet.');
  }

  lines.push('', '## Changed since the prior call', '');
  lines.push(brief.recentChanges.length
    ? markdownList(brief.recentChanges.map((item) => {
      const badges = item.badges?.length ? ` [${item.badges.join(', ')}]` : '';
      const citation = markdownTranscriptRef(item.evidence);
      return `**${item.title}**${badges}\n  - Detail: ${item.detail || 'Raised on the latest call.'}\n  - Citation: ${citation || 'none'}`;
    }))
    : '- No net-new facts since the previous call.');

  lines.push('', '## Open gaps by stakeholder', '');
  if (!brief.stakeholderGaps.length) {
    lines.push('- No stakeholder gaps captured yet.');
  } else {
    for (const group of brief.stakeholderGaps) {
      const badges = group.badges.length ? ` [${group.badges.join(', ')}]` : '';
      lines.push(`### ${group.name}${badges}`);
      lines.push('');
      lines.push(group.role || 'Stakeholder');
      lines.push('');
      lines.push(markdownList(group.items.map((item) => {
        const refs = [markdownTranscriptRef(item.transcriptEvidence), markdownLibraryRef(item.libraryEvidence)].filter(Boolean).join(' · ');
        return `**${item.title}**\n  - Gap: ${item.detail}\n  - Citations: ${refs || 'none'}`;
      })));
      lines.push('');
    }
  }

  lines.push('## Deal risks', '');
  lines.push(brief.risks.length
    ? markdownList(brief.risks.map((item) => `**${item.text}** · severity ${item.severity}${item.evidence ? ` · ${markdownTranscriptRef(item.evidence)}` : ''}`))
    : '- No risks flagged.');

  lines.push('', '## Suggested next questions', '');
  lines.push(brief.nextQuestions.length
    ? markdownList(brief.nextQuestions.map((item) => {
      const refs = [markdownTranscriptRef(item.transcriptEvidence), markdownLibraryRef(item.libraryEvidence)].filter(Boolean).join(' · ');
      return `**${item.stakeholder}**${item.role ? ` · ${item.role}` : ''}\n  - Ask: ${item.question}\n  - Why: ${item.detail}\n  - Citations: ${refs || 'none'}`;
    }))
    : '- No suggested questions yet.');

  lines.push('', '## Verified proof points', '');
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
