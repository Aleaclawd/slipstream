// Slipstream SPA — talks to the local API and renders the grounded action queue.
// API calls are RELATIVE to the page URL so the app works at the domain root and
// behind a path prefix (e.g. studio.apit.fun/slipstream/).
import { dealGaugeSVG, meddpiccBarsSVG, riskRadarSVG, mindMapSVG } from './views.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let last = null; // { meta, result }
let activeTab = 'brief';

const TABS = [
  ['brief', 'Brief'], ['mindmap', 'Mind Map'], ['kanban', 'Kanban'], ['steps', 'Steps'],
  ['scorecard', 'Scorecard'], ['risks', 'Risks'], ['stakeholders', 'Stakeholders'], ['battlecards', 'Battlecards'],
];
const COLORS = ['#2ee6c4', '#4aa8ff', '#ffb454', '#ff6b6b', '#c47dff'];

// ---- grounding: the hero feature ----
function evHtml(e) {
  if (!e || !e.quote) return `<div class="ev none">⚠ unverified — no transcript evidence</div>`;
  const where = [e.speaker, e.ts].filter(Boolean).join(' · ');
  return `<div class="ev"><span class="ln">line ${esc(e.line)}</span>${where ? ' · ' + esc(where) : ''} — “${esc(e.quote)}”</div>`;
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
  if (r.rfpRows.length) cards.push(card('RFP / security seed rows', r.rfpRows.length, wide(r.rfpRows.map((x) => `<div class="item"><div class="line1"><span class="chip ${x.status}">${esc(x.status)}</span><span class="t">${esc(x.question)}</span></div><div class="meta-row">${esc(x.suggestedAnswer)}</div>${evHtml(x.evidence)}</div>`).join(''))));
  if (r.followupEmail.subject || r.followupEmail.body) cards.push(card('Follow-up email', null, wide(`<div class="email"><span class="subj">Subject: ${esc(r.followupEmail.subject)}</span>\n\n${esc(r.followupEmail.body)}</div>`)));
  const kv = Object.entries(r.crmFields || {});
  if (kv.length) cards.push(card('CRM-ready fields', null, `<dl class="kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`));
  return `<div class="cards">${cards.join('')}</div>`;
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
  const r = last.result;
  const v = $('view');
  if (activeTab === 'brief') v.innerHTML = renderBrief(r);
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
  const r = data.result;
  $('dealName').textContent = r.summary.dealName || 'Deal';
  $('oneLiner').textContent = r.summary.oneLiner || '';
  $('tabs').innerHTML = TABS.map(([id, label]) => `<button class="tab${id === activeTab ? ' active' : ''}" data-tab="${id}" role="tab">${esc(label)}</button>`).join('');
  renderTab();
  $('output').hidden = false;
  const m = data.meta;
  const line = [`engine: ${m.engine}`, m.model ? `model: ${m.model}` : null, `${m.durationMs}ms`].filter(Boolean).join('  ·  ');
  $('meta').innerHTML = `<span class="ok">✓ ${esc(line)}</span>${m.note ? ` <span class="note">— ${esc(m.note)}</span>` : ''}`;
}

// ============================ actions ============================
async function analyze() {
  const transcript = $('transcript').value.trim();
  if (!transcript) return;
  const btn = $('analyze');
  btn.disabled = true;
  const useLlm = $('useLlm').checked;
  $('meta').textContent = useLlm ? 'analyzing with Claude (this can take ~1–2 min)…' : 'analyzing…';
  try {
    const res = await fetch('api/extract', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transcript, useLlm }) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'extract failed');
    render(data);
  } catch (e) {
    $('meta').innerHTML = `<span class="note">✗ ${esc(e.message)}</span>`;
  } finally {
    btn.disabled = false;
  }
}

async function doExport(kind) {
  if (!last) return;
  if (kind === 'webhook') {
    const res = await fetch('api/export/webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ result: last.result, meta: last.meta }) });
    const data = await res.json();
    $('modalTitle').textContent = 'CRM webhook payload (stub — no outbound call made)';
    $('modalBody').textContent = `# Payload\n${JSON.stringify(data.payload, null, 2)}\n\n# Deliver it yourself:\n${data.curl}`;
    $('modal').hidden = false;
    return;
  }
  const res = await fetch(`api/export/${kind}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(kind === 'json' ? last : { result: last.result }) });
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = kind === 'csv' ? 'slipstream-actions.csv' : 'slipstream-deal.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ============================ wiring ============================
$('analyze').addEventListener('click', analyze);
$('loadSample').addEventListener('click', async () => { $('transcript').value = await (await fetch('api/sample')).text(); });
$('tabs').addEventListener('click', (e) => { const t = e.target.closest('.tab'); if (!t) return; activeTab = t.dataset.tab; renderTab(); });
document.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => doExport(b.dataset.export)));
$('modalClose').addEventListener('click', () => ($('modal').hidden = true));
$('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('modal').hidden = true; });

(async () => {
  try {
    const h = await (await fetch('api/health')).json();
    $('status').innerHTML = h.llm ? `<span class="dot">●</span> Claude ${esc(h.model)}` : `<span class="dot off">●</span> deterministic engine`;
  } catch { $('status').textContent = 'offline'; }
})();

// Exported for Node render tests (ignored by the browser module loader).
export { renderBrief, renderScorecard, renderRisks, renderSteps, renderKanban, renderStakeholders, renderBattlecards };
