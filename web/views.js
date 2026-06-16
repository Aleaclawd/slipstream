// views.js — pure SVG-string renderers for Slipstream (zero-dep, no DOM).
// string in -> string out, so they can be assigned via innerHTML. Responsive viewBox.

const C = { line: '#233042', ink: '#e8eef6', muted: '#8aa0b6', accent: '#2ee6c4', accent2: '#4aa8ff', warn: '#ffb454', bad: '#ff6b6b' };
const FONT = 'font-family="Inter,system-ui,sans-serif"';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const scoreColor = (s) => (s >= 70 ? C.accent : s >= 40 ? C.warn : C.bad);
const trunc = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const clamp = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
const placeholder = (m) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 70" width="100%" role="img" aria-label="${esc(m)}"><text x="200" y="40" text-anchor="middle" ${FONT} font-size="13" fill="${C.muted}">${esc(m)}</text></svg>`;

// 1. Circular deal-health gauge.
export function dealGaugeSVG(score) {
  if (!Number.isFinite(score)) return placeholder('No score');
  const s = clamp(score), r = 50, c = 2 * Math.PI * r, dash = (s / 100) * c, col = scoreColor(s);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="100%" role="img" aria-label="Deal health ${s}">
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="${C.line}" stroke-width="12"/>
    <circle cx="60" cy="60" r="${r}" fill="none" stroke="${col}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} ${(c - dash).toFixed(1)}" transform="rotate(-90 60 60)"/>
    <text x="60" y="58" text-anchor="middle" dominant-baseline="middle" ${FONT} font-size="30" font-weight="800" fill="${col}">${s}</text>
    <text x="60" y="80" text-anchor="middle" ${FONT} font-size="8.5" fill="${C.muted}">DEAL HEALTH</text>
  </svg>`;
}

// 2. MEDDPICC horizontal bars.
export function meddpiccBarsSVG(dims) {
  if (!Array.isArray(dims) || !dims.length) return placeholder('No MEDDPICC data');
  const W = 480, pad = 14, labelW = 150, scoreW = 26, gap = 10, rowH = 30;
  const barX = pad + labelW + gap, barW = W - barX - scoreW - pad - gap, H = pad * 2 + dims.length * rowH;
  let rows = '';
  dims.forEach((d, i) => {
    const sc = clamp(d.score), y = pad + i * rowH + rowH / 2, col = scoreColor(sc), fw = Math.round((sc / 100) * barW);
    rows += `<text x="${pad}" y="${y}" dominant-baseline="middle" ${FONT} font-size="12" fill="${C.ink}">${esc(trunc(d.label || d.key || '', 22))}</text>
      <rect x="${barX}" y="${y - 6}" width="${barW}" height="12" rx="6" fill="${C.line}"/>
      ${fw > 0 ? `<rect x="${barX}" y="${y - 6}" width="${fw}" height="12" rx="6" fill="${col}"/>` : ''}
      <text x="${barX + barW + gap}" y="${y}" dominant-baseline="middle" ${FONT} font-size="12" font-weight="700" fill="${col}">${sc}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="MEDDPICC scores">${rows}</svg>`;
}

// 3. Radar (MEDDPICC coverage; gaps = risk).
export function riskRadarSVG(dims) {
  if (!Array.isArray(dims) || dims.length < 3) return placeholder('Not enough data for radar');
  const W = 480, H = 390, cx = W / 2, cy = H / 2 + 4, R = 132, n = dims.length;
  const ang = (i) => (2 * Math.PI * i) / n - Math.PI / 2;
  const pt = (i, r) => [cx + r * Math.cos(ang(i)), cy + r * Math.sin(ang(i))];
  const poly = (f) => Array.from({ length: n }, (_, i) => pt(i, f * R).map((v) => v.toFixed(1)).join(',')).join(' ');
  let g = '';
  [0.25, 0.5, 0.75, 1].forEach((f) => { g += `<polygon points="${poly(f)}" fill="none" stroke="${C.line}" stroke-width="1"/>`; });
  dims.forEach((_, i) => { const [x, y] = pt(i, R); g += `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${C.line}" stroke-width="1"/>`; });
  const sp = dims.map((d, i) => pt(i, (clamp(d.score) / 100) * R).map((v) => v.toFixed(1)).join(',')).join(' ');
  g += `<polygon points="${sp}" fill="${C.accent}" fill-opacity="0.15" stroke="${C.accent}" stroke-width="2"/>`;
  dims.forEach((d, i) => { const [x, y] = pt(i, (clamp(d.score) / 100) * R); g += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${scoreColor(clamp(d.score))}"/>`; });
  dims.forEach((d, i) => { const [x, y] = pt(i, R + 16); const a = x < cx - 4 ? 'end' : x > cx + 4 ? 'start' : 'middle'; g += `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${a}" dominant-baseline="middle" ${FONT} font-size="10" fill="${C.muted}">${esc((d.label || d.key || '').split(' ')[0])}</text>`; });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="MEDDPICC radar">${g}</svg>`;
}

// 4. Radial mind map.
const BRANCH = ['#2ee6c4', '#4aa8ff', '#ffb454', '#ff6b6b', '#c47dff'];
export function mindMapSVG(result) {
  if (!result || typeof result !== 'object') return placeholder('No deal data');
  const dealName = trunc(result.summary?.dealName || 'Deal', 24);
  const cats = [
    { label: 'Pains', items: (result.pains || []).map((p) => p.text) },
    { label: 'Stakeholders', items: (result.stakeholders || []).map((s) => s.name) },
    { label: 'Requirements', items: (result.requirements || []).map((r) => r.text) },
    { label: 'Competitors', items: (result.competitors || []).map((c) => c.name) },
    { label: 'Next Steps', items: (result.nextBestActions?.length ? result.nextBestActions.map((a) => a.action) : (result.actions || []).map((a) => a.title)) },
  ].filter((b) => b.items.length).slice(0, 5);
  if (!cats.length) return placeholder('No mind map data');
  const W = 1000, H = 700, cx = W / 2, cy = H / 2, bR = 230, lR = 112, n = cats.length;
  let g = '';
  cats.forEach((b, bi) => {
    const a = (2 * Math.PI * bi) / n - Math.PI / 2, bx = cx + bR * Math.cos(a), by = cy + bR * Math.sin(a), col = BRANCH[bi % 5];
    g += `<line x1="${cx}" y1="${cy}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="${col}" stroke-width="2" stroke-opacity="0.5"/>`;
    const leaves = b.items.slice(0, 3), nl = leaves.length;
    leaves.forEach((it, li) => {
      const spread = nl === 1 ? 0 : (li - (nl - 1) / 2) * (Math.PI / 5), la = a + spread;
      const lx = bx + lR * Math.cos(la), ly = by + lR * Math.sin(la), anc = lx < cx ? 'end' : 'start';
      g += `<line x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${lx.toFixed(1)}" y2="${ly.toFixed(1)}" stroke="${col}" stroke-width="1" stroke-opacity="0.35"/>
        <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3" fill="${col}" fill-opacity="0.7"/>
        <text x="${(lx + (anc === 'end' ? -7 : 7)).toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anc}" dominant-baseline="middle" ${FONT} font-size="11" fill="${C.ink}">${esc(trunc(it || '', 22))}</text>`;
    });
    g += `<circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="30" fill="#131d2a" stroke="${col}" stroke-width="2"/>
      <text x="${bx.toFixed(1)}" y="${by.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" ${FONT} font-size="12" font-weight="700" fill="${col}">${esc(b.label)}</text>`;
  });
  g += `<circle cx="${cx}" cy="${cy}" r="52" fill="#131d2a" stroke="${C.accent2}" stroke-width="2.5"/>
    <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" ${FONT} font-size="14" font-weight="800" fill="${C.ink}">${esc(dealName)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Deal mind map">${g}</svg>`;
}

// Node smoke test: `node web/views.js`
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('views.js')) {
  const dims = [{ label: 'Metrics', score: 80 }, { label: 'Economic Buyer', score: 40 }, { label: 'Decision Criteria', score: 70 }, { label: 'Decision Process', score: 55 }, { label: 'Paper Process', score: 60 }, { label: 'Identified Pain', score: 90 }, { label: 'Champion', score: 65 }, { label: 'Competition', score: 45 }];
  const res = { summary: { dealName: 'Northwind' }, pains: [{ text: 'manual reconciliation' }], stakeholders: [{ name: 'Dan' }], requirements: [{ text: 'Snowflake' }], competitors: [{ name: 'Gong' }], nextBestActions: [{ action: 'Send security pack' }] };
  for (const [n, svg] of [['gauge', dealGaugeSVG(68)], ['bars', meddpiccBarsSVG(dims)], ['radar', riskRadarSVG(dims)], ['mindmap', mindMapSVG(res)]]) {
    console.log(`[${typeof svg === 'string' && svg.trim().startsWith('<svg') ? 'PASS' : 'FAIL'}] ${n}: ${svg.trim().slice(0, 60)}`);
  }
}
