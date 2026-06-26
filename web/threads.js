const STORAGE_KEY = 'slipstream_threads_v1';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function slugify(value) {
  return String(value || 'thread')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'thread';
}

function threadNow(now) {
  return typeof now === 'function' ? now() : new Date().toISOString();
}

function emptyResult() {
  return {
    summary: { dealName: '', oneLiner: '' },
    stakeholders: [],
    pains: [],
    requirements: [],
    objections: [],
    competitors: [],
    actions: [],
    followupEmail: { subject: '', body: '' },
    demoPrep: [],
    rfpRows: [],
    crmFields: {},
    dealHealth: { score: 0, dimensions: [] },
    risks: [],
    nextBestActions: [],
    battlecards: [],
    analytics: { speakers: [], note: '' },
  };
}

function browserStorage(storage) {
  try {
    if (storage !== undefined) return storage || null;
    return globalThis.window?.localStorage || null;
  } catch {
    return null;
  }
}

function readStore(storage) {
  const target = browserStorage(storage);
  if (!target) return [];
  try {
    const raw = target.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStore(threads, storage) {
  const target = browserStorage(storage);
  if (!target) return threads;
  target.setItem(STORAGE_KEY, JSON.stringify(threads));
  return threads;
}

function firstNonEmpty(...values) {
  return values.find((value) => String(value || '').trim()) || '';
}

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function callLabel(call, index) {
  return call.label || `Call ${index + 1}`;
}

function annotateEvidence(evidence, call, index) {
  if (!evidence || typeof evidence !== 'object' || !evidence.quote) return evidence ?? null;
  return {
    ...clone(evidence),
    callId: call.id,
    callLabel: callLabel(call, index),
    callAt: call.createdAt,
  };
}

function annotateItem(item, call, index) {
  if (!item || typeof item !== 'object') return item;
  const next = clone(item);
  if ('evidence' in next) next.evidence = annotateEvidence(next.evidence, call, index);
  return next;
}

function preferEvidence(existing, incoming) {
  if (!existing) return incoming;
  if (existing?.evidence && !incoming?.evidence) return existing;
  if (!existing?.evidence && incoming?.evidence) return incoming;
  return incoming;
}

function mergeList(calls, selector, keyFn, prefer = preferEvidence) {
  const seen = new Map();
  calls.forEach((call, index) => {
    (selector(call.result) || []).forEach((item) => {
      const annotated = annotateItem(item, call, index);
      const key = normalizeKey(keyFn(annotated));
      if (!key) return;
      seen.set(key, prefer(seen.get(key), annotated));
    });
  });
  return [...seen.values()];
}

function preferRfp(existing, incoming) {
  if (!existing) return incoming;
  if (existing.status === 'verified' && incoming.status !== 'verified') return existing;
  if (existing.status !== 'verified' && incoming.status === 'verified') return incoming;
  return preferEvidence(existing, incoming);
}

function aggregateSpeakers(calls) {
  const speakers = new Map();
  calls.forEach((call) => {
    (call.result?.analytics?.speakers || []).forEach((speaker) => {
      const key = `${normalizeKey(speaker.name)}|${normalizeKey(speaker.role)}`;
      const current = speakers.get(key) || { name: speaker.name, role: speaker.role, turns: 0 };
      current.turns += Number(speaker.turns || 0);
      speakers.set(key, current);
    });
  });
  return [...speakers.values()].sort((a, b) => b.turns - a.turns);
}

export function createThreadRecord({ title, account = '' }, options = {}) {
  const createdAt = threadNow(options.now);
  const safeTitle = String(title || account || 'Untitled thread').trim();
  return {
    id: `${slugify(safeTitle)}-${createdAt.replace(/[-:.TZ]/g, '').slice(0, 14)}`,
    title: safeTitle,
    account: String(account || '').trim(),
    createdAt,
    updatedAt: createdAt,
    calls: [],
  };
}

export function createCallRecord({ transcript, meta, result, label }, options = {}) {
  const createdAt = threadNow(options.now);
  return {
    id: `call-${createdAt.replace(/[-:.TZ]/g, '').slice(0, 14)}`,
    createdAt,
    label: String(label || '').trim(),
    transcript: String(transcript || ''),
    meta: clone(meta) || {},
    result: clone(result) || emptyResult(),
  };
}

export function appendCallToThread(thread, callInput, options = {}) {
  const call = createCallRecord(callInput, options);
  const result = call.result || emptyResult();
  const account = firstNonEmpty(thread.account, result.crmFields?.Account);
  return {
    ...clone(thread),
    account,
    updatedAt: call.createdAt,
    calls: [...(thread.calls || []), call],
  };
}

export function aggregateThreadResult(thread) {
  const calls = Array.isArray(thread?.calls) ? thread.calls : [];
  if (!calls.length) return emptyResult();

  const latest = calls[calls.length - 1];
  const aggregate = emptyResult();

  aggregate.summary = {
    dealName: firstNonEmpty(thread.title, latest.result?.summary?.dealName, thread.account),
    oneLiner: firstNonEmpty(
      latest.result?.summary?.oneLiner,
      `${calls.length} saved call${calls.length === 1 ? '' : 's'} in this thread.`,
    ),
  };

  aggregate.stakeholders = mergeList(calls, (r) => r.stakeholders, (s) => `${s.name}|${s.role}`);
  aggregate.pains = mergeList(calls, (r) => r.pains, (p) => p.text);
  aggregate.requirements = mergeList(calls, (r) => r.requirements, (q) => `${q.category}|${q.text}`);
  aggregate.objections = mergeList(calls, (r) => r.objections, (o) => o.text);
  aggregate.competitors = mergeList(calls, (r) => r.competitors, (c) => c.name);
  aggregate.actions = mergeList(calls, (r) => r.actions, (a) => `${a.owner}|${a.title}|${a.due}`);
  aggregate.demoPrep = mergeList(calls, (r) => r.demoPrep, (d) => d.item);
  aggregate.rfpRows = mergeList(calls, (r) => r.rfpRows, (row) => row.question, preferRfp);
  aggregate.risks = mergeList(calls, (r) => r.risks, (risk) => `${risk.severity}|${risk.text}`);
  aggregate.nextBestActions = mergeList(calls, (r) => r.nextBestActions, (nba) => nba.action);
  aggregate.battlecards = mergeList(calls, (r) => r.battlecards, (card) => card.competitor);

  aggregate.crmFields = calls.reduce((fields, call) => {
    Object.entries(call.result?.crmFields || {}).forEach(([key, value]) => {
      if (String(value || '').trim()) fields[key] = value;
    });
    return fields;
  }, {});

  aggregate.followupEmail = clone(latest.result?.followupEmail) || { subject: '', body: '' };
  aggregate.dealHealth = {
    ...clone(latest.result?.dealHealth),
    dimensions: (latest.result?.dealHealth?.dimensions || []).map((dimension) =>
      annotateItem(dimension, latest, calls.length - 1)),
  };
  aggregate.analytics = {
    speakers: aggregateSpeakers(calls),
    note: `${calls.length} saved call${calls.length === 1 ? '' : 's'} · latest update ${new Date(thread.updatedAt).toLocaleString()}`,
  };

  return aggregate;
}

export function buildThreadView(thread) {
  const result = aggregateThreadResult(thread);
  const latestCall = thread.calls?.[thread.calls.length - 1];
  const latestMeta = latestCall?.meta || {};
  return {
    meta: {
      engine: 'thread-local',
      model: latestMeta.model || null,
      durationMs: latestMeta.durationMs || 0,
      grounded: true,
      judged: Boolean(latestMeta.judged),
      note: `${thread.calls.length} saved call${thread.calls.length === 1 ? '' : 's'} merged from local browser storage.`,
    },
    result,
    head: {
      title: thread.title,
      subtitle: `${thread.calls.length} call${thread.calls.length === 1 ? '' : 's'} · ${thread.account || result.crmFields?.Account || 'local-only thread'}`,
    },
  };
}

export function listThreadSummaries(threads) {
  return [...threads]
    .map((thread) => ({
      id: thread.id,
      title: thread.title,
      account: thread.account || '',
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      callCount: Array.isArray(thread.calls) ? thread.calls.length : 0,
    }))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export function loadThreads(storage) {
  return readStore(storage);
}

export function saveThreads(threads, storage) {
  return writeStore(threads, storage);
}

export function createThread(input, storage, options = {}) {
  const threads = readStore(storage);
  const thread = createThreadRecord(input, options);
  writeStore([...threads, thread], storage);
  return thread;
}

export function updateThread(threadId, updater, storage) {
  const threads = readStore(storage);
  const next = threads.map((thread) => (thread.id === threadId ? updater(thread) : thread));
  writeStore(next, storage);
  return next.find((thread) => thread.id === threadId) || null;
}

export function addCallToStoredThread(threadId, callInput, storage, options = {}) {
  return updateThread(threadId, (thread) => appendCallToThread(thread, callInput, options), storage);
}

export function getThreadById(threads, threadId) {
  return (threads || []).find((thread) => thread.id === threadId) || null;
}
