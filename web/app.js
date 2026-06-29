// Slipstream SPA — talks to the local API and renders the grounded action queue.
// API calls are RELATIVE to the page URL so the app works at the domain root and
// behind a path prefix (e.g. studio.apit.fun/slipstream/).
import { dealGaugeSVG, meddpiccBarsSVG, riskRadarSVG, mindMapSVG } from './views.js';
import { renderDealBriefPacket } from './deal-brief.js';
import {
  buildThreadView,
  getThreadById,
  listThreadSummaries,
} from './threads.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let last = null; // { meta, result, head?, brief? }
let activeTab = 'brief';
let threads = [];
let currentThreadId = null;
let currentViewDealId = null;
let libraryDocs = [];
let dashboardSummary = emptyDashboardSummary();

const TABS = [
  ['brief', 'Brief'], ['mindmap', 'Mind Map'], ['kanban', 'Kanban'], ['steps', 'Steps'],
  ['scorecard', 'Scorecard'], ['risks', 'Risks'], ['stakeholders', 'Stakeholders'], ['battlecards', 'Battlecards'],
];
const COLORS = ['#2ee6c4', '#4aa8ff', '#ffb454', '#ff6b6b', '#c47dff'];

function emptyDashboardSummary() {
  return {
    totals: {
      totalEvents: 0,
      callProcessed: 0,
      exportClicked: 0,
      dealReturned: 0,
    },
    exportsByKind: {
      csv: 0,
      json: 0,
      markdown: 0,
      html: 0,
      webhook: 0,
    },
    latestEventAt: null,
    deals: [],
    recentEvents: [],
  };
}

function selectedThread() {
  return getThreadById(threads, currentThreadId);
}

function selectedThreadLabel() {
  const thread = selectedThread();
  return thread ? `Add call to ${thread.title}` : 'Add call to deal';
}

function setMetaError(message) {
  $('meta').innerHTML = `<span class="note">✗ ${esc(message)}</span>`;
}

function setMetaBusy(message) {
  $('meta').textContent = message;
}

function setLibraryMeta(message) {
  $('libraryMeta').textContent = message || '';
}

function setDemoMeta(message) {
  $('demoMeta').textContent = message || '';
}

async function refreshThreads() {
  try {
    const res = await fetch('api/deals');
    const data = await res.json();
    threads = Array.isArray(data.deals) ? data.deals : [];
  } catch {
    threads = [];
  }
  if (!threads.length) currentThreadId = null;
  else if (!selectedThread()) currentThreadId = currentThreadId || threads[0]?.id || null;
  renderThreadSidebar();
}

function renderLibraryList() {
  $('libraryList').innerHTML = libraryDocs.length
    ? libraryDocs.map((doc) => `<div class="library-doc">
        <div>
          <div class="library-doc-name">${esc(doc.docName)}</div>
          <div class="library-doc-meta">${esc(doc.passageCount)} passage${doc.passageCount === 1 ? '' : 's'} · ${esc(doc.createdAt ? new Date(doc.createdAt).toLocaleString() : 'saved locally')}</div>
        </div>
        <button class="ghost sm" data-library-delete="${esc(doc.docId)}">Delete</button>
      </div>`).join('')
    : '<div class="library-empty">No grounding docs yet. Add the exact security or product text you want Slipstream to cite.</div>';
}

async function refreshLibrary() {
  try {
    const res = await fetch('api/library');
    const data = await res.json();
    libraryDocs = Array.isArray(data.docs) ? data.docs : [];
    renderLibraryList();
    setLibraryMeta(`${libraryDocs.length} doc${libraryDocs.length === 1 ? '' : 's'} loaded`);
  } catch {
    libraryDocs = [];
    renderLibraryList();
    setLibraryMeta('library offline');
  }
}

function dashboardStat(label, value, detail = '') {
  return `<div class="dashboard-stat">
    <span class="dashboard-stat-value">${esc(value)}</span>
    <span class="dashboard-stat-label">${esc(label)}</span>
    ${detail ? `<span class="dashboard-stat-detail">${esc(detail)}</span>` : ''}
  </div>`;
}

function eventSummary(event) {
  if (event.type === 'call_processed') {
    return `${event.callLabel || 'Call'} processed · ${event.callCount} call${event.callCount === 1 ? '' : 's'} saved`;
  }
  if (event.type === 'export_clicked') {
    return `${String(event.exportKind || 'export').toUpperCase()} export clicked`;
  }
  return `Workspace reopened · ${event.callCount} call${event.callCount === 1 ? '' : 's'} in view`;
}

function renderDashboard() {
  const summary = dashboardSummary || emptyDashboardSummary();
  const totals = summary.totals || emptyDashboardSummary().totals;
  const exportsByKind = { ...emptyDashboardSummary().exportsByKind, ...(summary.exportsByKind || {}) };
  const deals = Array.isArray(summary.deals) ? summary.deals : [];
  const recentEvents = Array.isArray(summary.recentEvents) ? summary.recentEvents : [];
  $('dashboardMeta').textContent = summary.latestEventAt
    ? `Last activity ${new Date(summary.latestEventAt).toLocaleString()}`
    : 'No local activity yet';
  $('dashboardStats').innerHTML = [
    dashboardStat('Calls processed', totals.callProcessed, `${totals.totalEvents} tracked event${totals.totalEvents === 1 ? '' : 's'}`),
    dashboardStat('Workspace returns', totals.dealReturned, `${deals.length} active deal${deals.length === 1 ? '' : 's'}`),
    dashboardStat(
      'Exports',
      totals.exportClicked,
      `CSV ${exportsByKind.csv} · JSON ${exportsByKind.json} · MD ${exportsByKind.markdown} · HTML ${exportsByKind.html} · Webhook ${exportsByKind.webhook}`,
    ),
  ].join('');

  if (!deals.length && !recentEvents.length) {
    $('dashboardList').innerHTML = '<div class="thread-empty">Load the private demo pack or use a deal workspace to populate local engagement telemetry.</div>';
    return;
  }

  const dealRows = deals.length
    ? `<div class="dashboard-section">
        <h4>Deal activity</h4>
        ${deals.map((deal) => `<div class="dashboard-row">
          <div class="dashboard-row-head">
            <span class="dashboard-row-title">${esc(deal.dealTitle || deal.dealId)}</span>
            <span class="dashboard-row-time">${esc(deal.callCount)} call${deal.callCount === 1 ? '' : 's'}</span>
          </div>
          <div class="dashboard-row-meta">${esc(deal.callProcessed)} processed · ${esc(deal.dealReturned)} returns · ${esc(deal.exportClicked)} exports</div>
        </div>`).join('')}
      </div>`
    : '';

  const recentRows = recentEvents.length
    ? `<div class="dashboard-section">
        <h4>Recent activity</h4>
        ${recentEvents.map((event) => `<div class="dashboard-row">
          <div class="dashboard-row-head">
            <span class="dashboard-row-title">${esc(eventSummary(event))}</span>
            <span class="dashboard-row-time">${esc(event.createdAt ? new Date(event.createdAt).toLocaleString() : '')}</span>
          </div>
          <div class="dashboard-row-meta">${esc(event.dealId || 'local')}</div>
        </div>`).join('')}
      </div>`
    : '';

  $('dashboardList').innerHTML = `${dealRows}${recentRows}`;
}

async function refreshDashboard() {
  try {
    const res = await fetch('api/dashboard');
    const data = await res.json();
    dashboardSummary = data.summary || emptyDashboardSummary();
    renderDashboard();
  } catch {
    dashboardSummary = emptyDashboardSummary();
    renderDashboard();
    $('dashboardMeta').textContent = 'dashboard offline';
  }
}

function renderCallHistory(thread) {
  const host = $('callHistory');
  if (!thread) {
    host.innerHTML = '<div class="thread-empty">Select a deal workspace to view saved calls.</div>';
    return;
  }
  if (!thread.calls.length) {
    host.innerHTML = '<div class="thread-empty">This deal has no saved calls yet. Paste a call and click “Add call to deal”.</div>';
    return;
  }
  host.innerHTML = thread.calls
    .slice()
    .reverse()
    .map((call, reverseIndex) => {
      const actualIndex = thread.calls.length - reverseIndex;
      const line = call.result?.summary?.oneLiner || call.result?.actions?.[0]?.title || 'Saved call';
      const engine = call.meta?.engine || 'deterministic';
      return `<div class="call-row">
        <div class="call-row-head">
          <span class="call-name">${esc(call.label || `Call ${actualIndex}`)}</span>
          <span class="call-time">${esc(new Date(call.createdAt).toLocaleString())}</span>
        </div>
        <div class="call-sub">${esc(engine)} · ${esc(line)}</div>
      </div>`;
    })
    .join('');
}

function renderThreadSidebar() {
  const thread = selectedThread();
  $('appendThreadCall').textContent = selectedThreadLabel();
  $('appendThreadCall').disabled = !thread;
  $('threadMeta').textContent = thread
    ? `${thread.calls.length} call${thread.calls.length === 1 ? '' : 's'} saved · ${thread.account || 'local saved workspace'}`
    : 'Create or select a deal workspace to preserve multi-call continuity on this host.';

  const summaries = listThreadSummaries(threads);
  $('threadList').innerHTML = summaries.length
    ? summaries.map((item) => {
      const selected = item.id === currentThreadId;
      const sub = `${item.callCount} call${item.callCount === 1 ? '' : 's'} · ${item.account || 'saved deal'}`;
      return `<button class="thread-row${selected ? ' selected' : ''}" data-thread-id="${esc(item.id)}">
        <span class="thread-title">${esc(item.title)}</span>
        <span class="thread-sub">${esc(sub)}</span>
      </button>`;
    }).join('')
    : '<div class="thread-empty">No deal workspaces saved yet. Create one for the return-flow demo.</div>';

  renderCallHistory(thread);
}

async function showThread(threadId, options = {}) {
  currentThreadId = threadId;
  renderThreadSidebar();
  const thread = selectedThread();
  if (!thread) return;
  if (!thread.calls.length) {
    last = null;
    currentViewDealId = null;
    $('output').hidden = true;
    $('briefExports').hidden = true;
    setMetaBusy(`Loaded ${thread.title}. Paste the next call and click “Add call to deal”.`);
    return;
  }
  if (options.recordReturn === false) {
    render(buildThreadView(thread));
    return;
  }
  try {
    const res = await fetch(`api/deals/${encodeURIComponent(threadId)}/return`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'deal load failed');
    threads = Array.isArray(data.deals) ? data.deals : threads;
    renderThreadSidebar();
    render({ ...data.view, brief: data.brief || null });
    await refreshDashboard();
  } catch (error) {
    setMetaError(error.message);
    render(buildThreadView(thread));
  }
}

// ---- grounding: the hero feature ----
function evHtml(e) {
  if (!e || !e.quote) return `<div class="ev none">⚠ unverified — no transcript evidence</div>`;
  const where = [e.callLabel, e.speaker, e.ts].filter(Boolean).join(' · ');
  return `<div class="ev"><span class="ln">line ${esc(e.line)}</span>${where ? ' · ' + esc(where) : ''} — “${esc(e.quote)}”</div>`;
}
function requestEvidenceHtml(e) {
  if (!e || !e.quote) return '';
  const where = [e.callLabel, e.speaker, e.ts].filter(Boolean).join(' · ');
  return `<div class="ev"><span class="ln">asked on call · line ${esc(e.line)}</span>${where ? ' · ' + esc(where) : ''} — “${esc(e.quote)}”</div>`;
}
function libraryEvidenceHtml(e) {
  if (!e || !e.quote) return '';
  return `<div class="ev library"><span class="ln">${esc(e.docName)} · ${esc(e.heading)}</span> · line ${esc(e.line)} — “${esc(e.quote)}”</div>`;
}
function sourceChipHtml(row) {
  if (row.answerSource === 'call') return '<span class="chip source call">call-grounded</span>';
  if (row.answerSource === 'library' && row.libraryEvidence) {
    return `<span class="chip source library">${esc(row.libraryEvidence.docName)} · ${esc(row.libraryEvidence.heading)}</span>`;
  }
  return '<span class="chip source none">needs review</span>';
}
function unverifiedStateHtml(row) {
  if (row.status !== 'unverified' || row.answerSource !== 'none') return '';
  return '<div class="unverified-state">No match in your library — needs a human, or add a doc.</div>';
}
const sevChip = (s) => `<span class="chip ${esc(s)}">${esc(s)}</span>`;
const priChip = (p) => `<span class="chip ${esc(String(p).toLowerCase())}">${esc(p)}</span>`;
const scoreChip = (n) => `<span class="chip ${n >= 70 ? 'verified' : n >= 40 ? 'med' : 'high'}">${esc(n)}</span>`;

function card(title, count, inner) {
  const wide = inner && inner.__wide;
  const body = wide ? inner.html : inner;
  return `<div class="card${wide ? ' wide' : ''}"><h3>${esc(title)}${count != null ? ` <span class="count">${count}</span>` : ''}</h3>${body}</div>`;
}
const wide = (html) => ({ __wide: true, html });

// ============================ tab views ============================
function renderBrief(r) {
  const cards = [];
  if (r.pains.length) cards.push(card('Pains', r.pains.length, r.pains.map((p) => `<div class="item"><div class="line1">${sevChip(p.severity)}<span class="t">${esc(p.text)}</span></div>${evHtml(p.evidence)}</div>`).join('')));
  if (r.requirements.length) cards.push(card('Technical requirements', r.requirements.length, wide(r.requirements.map((q) => `<div class="item"><div class="line1"><span class="chip cat">${esc(q.category.replace('_', ' '))}</span><span class="t">${esc(q.text)}</span></div>${evHtml(q.evidence)}</div>`).join(''))));
  if (r.objections.length) cards.push(card('Objections', r.objections.length, r.objections.map((o) => `<div class="item"><div class="t">${esc(o.text)}</div>${evHtml(o.evidence)}</div>`).join('')));
  if (r.competitors.length) cards.push(card('Competitors', r.competitors.length, r.competitors.map((c) => `<div class="item"><div class="t">${esc(c.name)}</div>${evHtml(c.evidence)}</div>`).join('')));
  if (r.demoPrep.length) cards.push(card('Demo / POC prep', r.demoPrep.length, r.demoPrep.map((d) => `<div class="item"><div class="t">${esc(d.item)}</div>${d.rationale ? `<div class="meta-row">${esc(d.rationale)}</div>` : ''}${evHtml(d.evidence)}</div>`).join('')));
  if (r.rfpRows.length) cards.push(card('RFP / security seed rows', r.rfpRows.length, wide(r.rfpRows.map((x) => `<div class="item"><div class="line1"><span class="chip ${x.status}">${esc(x.status)}</span>${sourceChipHtml(x)}<span class="t">${esc(x.question)}</span></div><div class="meta-row">${esc(x.suggestedAnswer)}</div>${x.answerSource === 'library' ? libraryEvidenceHtml(x.libraryEvidence) : ''}${x.answerSource !== 'call' ? requestEvidenceHtml(x.evidence) : evHtml(x.evidence)}${unverifiedStateHtml(x)}</div>`).join(''))));
  if (r.followupEmail.subject || r.followupEmail.body) cards.push(card('Latest follow-up email', null, wide(`<div class="email"><span class="subj">Subject: ${esc(r.followupEmail.subject)}</span>\n\n${esc(r.followupEmail.body)}</div>`)));
  const kv = Object.entries(r.crmFields || {});
  if (kv.length) cards.push(card('CRM-ready fields', null, `<dl class="kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`));
  return `<div class="cards">${cards.join('')}</div>`;
}

function renderDealBrief(brief) {
  return renderDealBriefPacket(brief);
}

function renderScorecard(r) {
  const dh = r.dealHealth;
  return `<div class="scorecard">
    <div class="gauge-wrap"><div class="chart">${dealGaugeSVG(dh.score)}</div><div class="lead" style="margin-top:6px">MEDDPICC composite</div></div>
    <div>
      <h3>MEDDPICC coverage</h3>
      <div class="panel"><div class="chart">${meddpiccBarsSVG(dh.dimensions)}</div></div>
      <div style="margin-top:14px">${dh.dimensions.map((d) => `<div class="item"><div class="line1"><span class="t">${esc(d.label)}</span>${scoreChip(d.score)}</div><div class="meta-row">${esc(d.note)}</div>${evHtml(d.evidence)}</div>`).join('')}</div>
    </div></div>`;
}

function renderRisks(r) {
  return `<div class="grid2">
    <div class="panel"><h3>MEDDPICC radar — gaps are risk</h3><div class="chart">${riskRadarSVG(r.dealHealth.dimensions)}</div></div>
    <div><h3>Risks (${r.risks.length})</h3>${r.risks.map((x) => `<div class="item"><div class="line1">${sevChip(x.severity)}<span class="t">${esc(x.text)}</span></div>${evHtml(x.evidence)}</div>`).join('') || '<div class="lead">No risks flagged.</div>'}</div>
  </div>`;
}

function renderSteps(r) {
  const order = { P1: 0, P2: 1, P3: 2 };
  const steps = [
    ...r.nextBestActions.map((n) => ({ t: n.action, why: n.rationale, pri: n.priority, ev: n.evidence })),
    ...r.actions.map((a) => ({ t: a.title, why: a.owner + (a.due ? ' · due ' + a.due : ''), pri: a.priority, ev: a.evidence })),
  ].sort((a, b) => (order[a.pri] ?? 9) - (order[b.pri] ?? 9));
  if (!steps.length) return '<div class="lead">No steps.</div>';
  return `<h3>Recommended play (${steps.length} steps)</h3><div class="steps">${steps.map((s) => `<div class="step"><div class="t">${priChip(s.pri)} ${esc(s.t)}</div><div class="why">${esc(s.why)}</div>${evHtml(s.ev)}</div>`).join('')}</div>`;
}

function renderKanban(r) {
  const items = [
    ...r.actions.map((a, i) => ({ id: 'a' + i, cls: '', title: a.title, tag: a.owner, pri: a.priority, ev: a.evidence })),
    ...r.nextBestActions.map((n, i) => ({ id: 'n' + i, cls: 'nba', title: n.action, tag: 'AI', pri: n.priority, ev: n.evidence })),
  ];
  const cols = [['P1', 'Now'], ['P2', 'Next'], ['P3', 'Later']];
  return `<p class="lead">Drag cards between columns. <span style="color:var(--accent-2)">Blue</span> = AI next-best-action, <span style="color:var(--accent)">teal</span> = call commitment.</p>
    <div class="kanban">${cols.map(([p, label]) => {
      const cs = items.filter((it) => it.pri === p);
      return `<div class="kcol" data-col="${p}"><h4>${label} <span class="n">${cs.length}</span></h4><div class="kcol-body">${cs.map((it) => `<div class="kcard ${it.cls}" draggable="true" data-id="${it.id}"><div class="line1"><span class="t">${esc(it.title)}</span></div><div style="margin-top:4px"><span class="tag">${esc(it.tag)}</span></div>${evHtml(it.ev)}</div>`).join('')}</div></div>`;
    }).join('')}</div>`;
}
function wireKanban() {
  let dragId = null;
  document.querySelectorAll('.kcard').forEach((c) => c.addEventListener('dragstart', (e) => { dragId = c.dataset.id; e.dataTransfer.effectAllowed = 'move'; }));
  document.querySelectorAll('.kcol').forEach((col) => {
    col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drop'); });
    col.addEventListener('dragleave', () => col.classList.remove('drop'));
    col.addEventListener('drop', (e) => {
      e.preventDefault(); col.classList.remove('drop');
      const cardEl = document.querySelector(`.kcard[data-id="${dragId}"]`);
      const body = col.querySelector('.kcol-body');
      if (cardEl && body) body.appendChild(cardEl);
    });
  });
}

function renderStakeholders(r) {
  const cm = r.crmFields || {};
  const badge = (name) => (name && name === cm.Champion ? 'Champion' : name && name === cm.EconomicBuyer ? 'Economic Buyer' : '');
  const stk = r.stakeholders.map((s) => { const b = badge(s.name); return `<div class="stk"><div class="nm">${esc(s.name)} ${b ? `<span class="chip owner">${esc(b)}</span>` : ''}</div><div class="ro">${esc(s.role)}</div>${evHtml(s.evidence)}</div>`; }).join('');
  const sp = r.analytics.speakers || [];
  const tot = sp.reduce((n, s) => n + s.turns, 0) || 1;
  const bar = sp.map((s, i) => `<span style="width:${(s.turns / tot * 100).toFixed(1)}%;background:${COLORS[i % 5]}" title="${esc(s.name)}: ${esc(s.turns)} turns"></span>`).join('');
  return `<h3>Buying committee (${r.stakeholders.length})</h3>
    <p class="lead">${esc(r.analytics.note || '')}</p>
    <div class="committee">${stk || '<div class="lead">No stakeholders.</div>'}</div>
    ${sp.length ? `<h3 style="margin-top:22px">Talk distribution</h3><div class="talk">${bar}</div><div class="lead">${sp.map((s) => esc(s.name) + ' ' + esc(s.turns)).join('  ·  ')}</div>` : ''}`;
}

function renderBattlecards(r) {
  if (!r.battlecards.length) return '<div class="lead">No competitors detected in this call.</div>';
  return r.battlecards.map((b) => `<div class="bc"><h4>vs ${esc(b.competitor)}</h4>
    <div class="row"><span class="k">Their angle</span><span>${esc(b.theirAngle)}</span></div>
    <div class="row"><span class="k">Our counter</span><span>${esc(b.ourCounter)}</span></div>
    ${evHtml(b.evidence)}</div>`).join('');
}

function renderTab() {
  if (!last) return;
  const r = last.result;
  const v = $('view');
  if (activeTab === 'brief') v.innerHTML = last.brief ? renderDealBrief(last.brief) : renderBrief(r);
  else if (activeTab === 'mindmap') v.innerHTML = `<div class="mindmap-wrap"><div class="chart">${mindMapSVG(r)}</div></div>`;
  else if (activeTab === 'kanban') { v.innerHTML = renderKanban(r); wireKanban(); }
  else if (activeTab === 'steps') v.innerHTML = renderSteps(r);
  else if (activeTab === 'scorecard') v.innerHTML = renderScorecard(r);
  else if (activeTab === 'risks') v.innerHTML = renderRisks(r);
  else if (activeTab === 'stakeholders') v.innerHTML = renderStakeholders(r);
  else if (activeTab === 'battlecards') v.innerHTML = renderBattlecards(r);
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === activeTab));
}

function render(data) {
  last = data;
  currentViewDealId = data.head?.dealId || null;
  const r = data.result;
  $('briefExports').hidden = !data.brief;
  $('dealName').textContent = data.head?.title || r.summary.dealName || 'Deal';
  $('oneLiner').textContent = data.head?.subtitle || r.summary.oneLiner || '';
  $('tabs').innerHTML = TABS.map(([id, label]) => `<button class="tab${id === activeTab ? ' active' : ''}" data-tab="${id}" role="tab">${esc(label)}</button>`).join('');
  renderTab();
  $('output').hidden = false;
  const m = data.meta;
  const line = [`engine: ${m.engine}`, m.model ? `model: ${m.model}` : null, `${m.durationMs}ms`].filter(Boolean).join('  ·  ');
  $('meta').innerHTML = `<span class="ok">✓ ${esc(line)}</span>${m.note ? ` <span class="note">— ${esc(m.note)}</span>` : ''}`;
}

async function fetchExtraction(transcript, useLlm) {
  const res = await fetch('api/extract', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ transcript, useLlm }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'extract failed');
  return data;
}

async function loadSample(name) {
  const url = name && name !== 'default' ? `api/sample?name=${encodeURIComponent(name)}` : 'api/sample';
  $('transcript').value = await (await fetch(url)).text();
}

// ============================ actions ============================
async function analyze() {
  const transcript = $('transcript').value.trim();
  if (!transcript) return;
  const btn = $('analyze');
  btn.disabled = true;
  const useLlm = $('useLlm').checked;
  setMetaBusy(useLlm ? 'analyzing with Claude (this can take ~1–2 min)…' : 'analyzing…');
  try {
    render(await fetchExtraction(transcript, useLlm));
  } catch (e) {
    setMetaError(e.message);
  } finally {
    btn.disabled = false;
  }
}

async function appendThreadCall() {
  const thread = selectedThread();
  const transcript = $('transcript').value.trim();
  if (!thread) return setMetaError('Select or create a deal workspace first.');
  if (!transcript) return;

  const btn = $('appendThreadCall');
  btn.disabled = true;
  const useLlm = $('useLlm').checked;
  setMetaBusy(`saving this call into ${thread.title}…`);
  try {
    const res = await fetch(`api/deals/${encodeURIComponent(thread.id)}/calls`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        transcript,
        useLlm,
        label: thread.calls.length ? `Call ${thread.calls.length + 1}` : 'Call 1',
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'save failed');
    threads = Array.isArray(data.deals) ? data.deals : threads;
    currentThreadId = data.deal?.id || currentThreadId;
    renderThreadSidebar();
    render({ ...data.view, brief: data.brief || null });
    $('transcript').value = '';
    await refreshDashboard();
  } catch (e) {
    setMetaError(e.message);
  } finally {
    btn.disabled = false;
    renderThreadSidebar();
  }
}

async function createNewThread() {
  const name = $('threadName').value.trim();
  if (!name) return setMetaError('Enter a deal name or prospect before creating a workspace.');
  setMetaBusy('creating deal workspace…');
  try {
    const res = await fetch('api/deals', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'create failed');
    threads = Array.isArray(data.deals) ? data.deals : threads;
    currentThreadId = data.deal?.id || null;
    $('threadName').value = '';
    await showThread(currentThreadId, { recordReturn: false });
  } catch (error) {
    setMetaError(error.message);
  }
}

async function saveLibraryDoc() {
  const name = $('libraryDocName').value.trim();
  const text = $('libraryDocText').value.trim();
  const file = $('libraryFile').files?.[0];
  if (!name || !text) return setLibraryMeta('name and doc text are required');
  setLibraryMeta('saving…');
  try {
    const res = await fetch('api/library', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, text, contentType: file?.type || 'text/plain' }),
    });
    const data = await res.json();
    if (!res.ok) return setLibraryMeta(data.error || 'save failed');
    $('libraryDocName').value = '';
    $('libraryDocText').value = '';
    $('libraryFile').value = '';
    libraryDocs = Array.isArray(data.docs) ? data.docs : libraryDocs;
    renderLibraryList();
    setLibraryMeta(`saved ${data.doc.docName}`);
  } catch {
    setLibraryMeta('save failed');
  }
}

async function deleteLibraryDoc(docId) {
  setLibraryMeta('deleting…');
  try {
    const res = await fetch(`api/library/${encodeURIComponent(docId)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) return setLibraryMeta(data.error || 'delete failed');
    libraryDocs = Array.isArray(data.docs) ? data.docs : [];
    renderLibraryList();
    setLibraryMeta('document removed');
  } catch {
    setLibraryMeta('delete failed');
  }
}

async function loadDemoPack() {
  setDemoMeta('loading…');
  try {
    const res = await fetch('api/demo/load', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'demo load failed');
    threads = Array.isArray(data.deals) ? data.deals : [];
    libraryDocs = Array.isArray(data.docs) ? data.docs : [];
    dashboardSummary = data.dashboard || emptyDashboardSummary();
    currentThreadId = data.demoDealId || threads[0]?.id || null;
    renderLibraryList();
    renderThreadSidebar();
    renderDashboard();
    if (data.view) render({ ...data.view, brief: data.brief || null });
    $('transcript').value = '';
    setDemoMeta('loaded locally');
    setLibraryMeta(`${libraryDocs.length} doc${libraryDocs.length === 1 ? '' : 's'} loaded`);
  } catch (error) {
    setDemoMeta(error.message || 'demo load failed');
  }
}

async function resetDemoData() {
  setDemoMeta('resetting…');
  try {
    const res = await fetch('api/demo/reset', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'reset failed');
    threads = [];
    libraryDocs = [];
    dashboardSummary = data.dashboard || emptyDashboardSummary();
    currentThreadId = null;
    currentViewDealId = null;
    last = null;
    $('transcript').value = '';
    $('output').hidden = true;
    $('briefExports').hidden = true;
    renderLibraryList();
    renderThreadSidebar();
    renderDashboard();
    setDemoMeta('local data cleared');
    setLibraryMeta('0 docs loaded');
    setMetaBusy('Local demo data reset.');
  } catch (error) {
    setDemoMeta(error.message || 'reset failed');
  }
}

async function doExport(kind) {
  if (!last) return;
  const dealId = currentViewDealId;
  if (kind === 'webhook') {
    const res = await fetch('api/export/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ result: last.result, meta: last.meta, dealId }),
    });
    const data = await res.json();
    if (!res.ok) return setMetaError(data.error || 'export failed');
    $('modalTitle').textContent = 'CRM webhook payload (stub — no outbound call made)';
    $('modalBody').textContent = `# Payload\n${JSON.stringify(data.payload, null, 2)}\n\n# Deliver it yourself:\n${data.curl}`;
    $('modal').hidden = false;
    await refreshDashboard();
    return;
  }
  const res = await fetch(`api/export/${kind}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(kind === 'json' ? { ...last, dealId } : { result: last.result, dealId }),
  });
  if (!res.ok) {
    const data = await res.json();
    return setMetaError(data.error || 'export failed');
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = kind === 'csv' ? 'slipstream-actions.csv' : 'slipstream-deal.json';
  a.click();
  URL.revokeObjectURL(a.href);
  await refreshDashboard();
}

function fallbackCopy(text) {
  const node = document.createElement('textarea');
  node.value = text;
  node.setAttribute('readonly', 'readonly');
  node.style.position = 'fixed';
  node.style.top = '-999px';
  document.body.appendChild(node);
  node.select();
  document.execCommand('copy');
  document.body.removeChild(node);
}

async function fetchBriefExport(kind) {
  if (!currentViewDealId) throw new Error('brief exports require a saved deal workspace');
  const res = await fetch(`api/export/brief/${kind}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ dealId: currentViewDealId }),
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'brief export failed');
  }
  return res;
}

async function copyDealBrief() {
  try {
    const res = await fetchBriefExport('markdown');
    const text = await res.text();
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else fallbackCopy(text);
    setMetaBusy('Champion evidence packet copied as markdown.');
    await refreshDashboard();
  } catch (error) {
    setMetaError(error.message || 'copy failed');
  }
}

async function downloadBrief(kind) {
  try {
    const res = await fetchBriefExport(kind);
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') || '';
    const fileName = disposition.match(/filename="([^"]+)"/)?.[1] || `slipstream-deal-brief.${kind === 'markdown' ? 'md' : 'html'}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
    await refreshDashboard();
  } catch (error) {
    setMetaError(error.message || 'brief export failed');
  }
}

// ============================ wiring ============================
$('analyze').addEventListener('click', analyze);
$('appendThreadCall').addEventListener('click', appendThreadCall);
$('createThread').addEventListener('click', createNewThread);
$('saveLibraryDoc').addEventListener('click', saveLibraryDoc);
$('loadSample').addEventListener('click', async () => loadSample('default'));
$('loadFollowup').addEventListener('click', async () => loadSample('followup'));
$('loadDemoPack').addEventListener('click', loadDemoPack);
$('resetDemoData').addEventListener('click', resetDemoData);
$('libraryFile').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  $('libraryDocName').value = file.name;
  $('libraryDocText').value = await file.text();
  setLibraryMeta(`loaded ${file.name}`);
});
$('threadList').addEventListener('click', (e) => {
  const button = e.target.closest('.thread-row');
  if (!button) return;
  showThread(button.dataset.threadId);
});
$('libraryList').addEventListener('click', (e) => {
  const button = e.target.closest('[data-library-delete]');
  if (!button) return;
  deleteLibraryDoc(button.dataset.libraryDelete);
});
$('tabs').addEventListener('click', (e) => { const t = e.target.closest('.tab'); if (!t) return; activeTab = t.dataset.tab; renderTab(); });
document.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => doExport(b.dataset.export)));
document.querySelectorAll('[data-brief-export]').forEach((b) => b.addEventListener('click', () => downloadBrief(b.dataset.briefExport)));
$('copyDealBrief').addEventListener('click', copyDealBrief);
$('modalClose').addEventListener('click', () => ($('modal').hidden = true));
$('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('modal').hidden = true; });

(async () => {
  await refreshThreads();
  await refreshLibrary();
  await refreshDashboard();
  try {
    const h = await (await fetch('api/health')).json();
    $('status').innerHTML = h.llm ? `<span class="dot">●</span> Claude ${esc(h.model)}` : `<span class="dot off">●</span> deterministic engine`;
  } catch {
    $('status').textContent = 'offline';
  }
})();

// Exported for Node render tests (ignored by the browser module loader).
export { renderBrief, renderDealBrief, renderScorecard, renderRisks, renderSteps, renderKanban, renderStakeholders, renderBattlecards };
