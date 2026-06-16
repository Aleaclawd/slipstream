// Slipstream SPA — talks to the local API and renders the grounded action queue.
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let last = null; // { meta, result }

// ---- evidence rendering: the hero feature ----
function evHtml(e) {
  if (!e || !e.quote) {
    return `<div class="ev none">⚠ unverified — no transcript evidence</div>`;
  }
  const where = [e.speaker, e.ts].filter(Boolean).join(' · ');
  return `<div class="ev"><span class="ln">line ${esc(e.line)}</span>${
    where ? ' · ' + esc(where) : ''
  } — “${esc(e.quote)}”</div>`;
}

function card(title, count, inner) {
  const wide = inner.__wide ? ' wide' : '';
  const body = inner.__wide ? inner.html : inner;
  return `<div class="card${wide}"><h3>${esc(title)}${
    count != null ? ` <span class="count">${count}</span>` : ''
  }</h3>${body}</div>`;
}
const wide = (html) => ({ __wide: true, html });

function render({ meta, result }) {
  $('dealName').textContent = result.summary.dealName || 'Deal';
  $('oneLiner').textContent = result.summary.oneLiner || '';
  const cards = [];

  // Pains
  if (result.pains.length)
    cards.push(
      card(
        'Pains',
        result.pains.length,
        result.pains
          .map(
            (p) =>
              `<div class="item"><div class="line1"><span class="chip ${p.severity}">${p.severity}</span><span class="t">${esc(
                p.text
              )}</span></div>${evHtml(p.evidence)}</div>`
          )
          .join('')
      )
    );

  // Stakeholders
  if (result.stakeholders.length)
    cards.push(
      card(
        'Stakeholders',
        result.stakeholders.length,
        result.stakeholders
          .map(
            (s) =>
              `<div class="item"><div class="line1"><span class="t">${esc(s.name)}</span><span class="meta-row">${esc(
                s.role
              )}</span></div>${evHtml(s.evidence)}</div>`
          )
          .join('')
      )
    );

  // Requirements
  if (result.requirements.length)
    cards.push(
      card(
        'Technical requirements',
        result.requirements.length,
        wide(
          result.requirements
            .map(
              (r) =>
                `<div class="item"><div class="line1"><span class="chip cat">${esc(
                  r.category.replace('_', ' ')
                )}</span><span class="t">${esc(r.text)}</span></div>${evHtml(r.evidence)}</div>`
            )
            .join('')
        )
      )
    );

  // Action queue
  if (result.actions.length)
    cards.push(
      card(
        'Action queue',
        result.actions.length,
        wide(
          result.actions
            .map(
              (a) =>
                `<div class="item"><div class="line1"><span class="chip ${a.priority.toLowerCase()}">${esc(
                  a.priority
                )}</span><span class="t">${esc(a.title)}</span><span class="chip owner">${esc(
                  a.owner
                )}</span>${a.due ? `<span class="meta-row">due ${esc(a.due)}</span>` : ''}</div>${evHtml(
                  a.evidence
                )}</div>`
            )
            .join('')
        )
      )
    );

  // Objections + competitors (compact pair)
  if (result.objections.length)
    cards.push(
      card(
        'Objections',
        result.objections.length,
        result.objections.map((o) => `<div class="item"><div class="t">${esc(o.text)}</div>${evHtml(o.evidence)}</div>`).join('')
      )
    );
  if (result.competitors.length)
    cards.push(
      card(
        'Competitors',
        result.competitors.length,
        result.competitors
          .map((c) => `<div class="item"><div class="t">${esc(c.name)}</div>${evHtml(c.evidence)}</div>`)
          .join('')
      )
    );

  // Demo / POC prep
  if (result.demoPrep.length)
    cards.push(
      card(
        'Demo / POC prep',
        result.demoPrep.length,
        result.demoPrep
          .map(
            (d) =>
              `<div class="item"><div class="t">${esc(d.item)}</div>${
                d.rationale ? `<div class="meta-row">${esc(d.rationale)}</div>` : ''
              }${evHtml(d.evidence)}</div>`
          )
          .join('')
      )
    );

  // RFP / security questionnaire seed
  if (result.rfpRows.length)
    cards.push(
      card(
        'RFP / security seed rows',
        result.rfpRows.length,
        wide(
          result.rfpRows
            .map(
              (r) =>
                `<div class="item"><div class="line1"><span class="chip ${r.status}">${esc(
                  r.status
                )}</span><span class="t">${esc(r.question)}</span></div><div class="meta-row">${esc(
                  r.suggestedAnswer
                )}</div>${evHtml(r.evidence)}</div>`
            )
            .join('')
        )
      )
    );

  // Follow-up email
  if (result.followupEmail.subject || result.followupEmail.body)
    cards.push(
      card(
        'Follow-up email',
        null,
        wide(
          `<div class="email"><span class="subj">Subject: ${esc(result.followupEmail.subject)}</span>\n\n${esc(
            result.followupEmail.body
          )}</div>`
        )
      )
    );

  // CRM fields
  const kv = Object.entries(result.crmFields || {});
  if (kv.length)
    cards.push(
      card(
        'CRM-ready fields',
        null,
        `<dl class="kv">${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`
      )
    );

  $('cards').innerHTML = cards.join('');
  $('output').hidden = false;

  const m = [`engine: ${meta.engine}`, meta.model ? `model: ${meta.model}` : null, `${meta.durationMs}ms`]
    .filter(Boolean)
    .join('  ·  ');
  $('meta').innerHTML = `<span class="ok">✓ ${m}</span>${meta.note ? ` <span class="note">— ${esc(meta.note)}</span>` : ''}`;
}

async function analyze() {
  const transcript = $('transcript').value.trim();
  if (!transcript) return;
  const btn = $('analyze');
  btn.disabled = true;
  $('meta').textContent = 'analyzing…';
  try {
    const res = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transcript, useLlm: $('useLlm').checked }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'extract failed');
    last = data;
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
    const res = await fetch('/api/export/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ result: last.result, meta: last.meta }),
    });
    const data = await res.json();
    $('modalTitle').textContent = 'CRM webhook payload (stub — no outbound call made)';
    $('modalBody').textContent = `# Payload\n${JSON.stringify(data.payload, null, 2)}\n\n# Deliver it yourself:\n${data.curl}`;
    $('modal').hidden = false;
    return;
  }
  const res = await fetch(`/api/export/${kind}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(kind === 'json' ? last : { result: last.result }),
  });
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = kind === 'csv' ? 'slipstream-actions.csv' : 'slipstream-deal.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---- wiring ----
$('analyze').addEventListener('click', analyze);
$('loadSample').addEventListener('click', async () => {
  $('transcript').value = await (await fetch('/api/sample')).text();
});
document.querySelectorAll('[data-export]').forEach((b) =>
  b.addEventListener('click', () => doExport(b.dataset.export))
);
$('modalClose').addEventListener('click', () => ($('modal').hidden = true));
$('modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') $('modal').hidden = true;
});

(async () => {
  try {
    const h = await (await fetch('/api/health')).json();
    $('status').innerHTML = h.llm
      ? `<span class="dot">●</span> Claude ${esc(h.model)}`
      : `<span class="dot off">●</span> deterministic engine`;
  } catch {
    $('status').textContent = 'offline';
  }
})();
