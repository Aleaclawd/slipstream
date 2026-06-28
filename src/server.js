// Slipstream MVP server — zero-dependency Node HTTP.
//
//   node src/server.js      then open http://localhost:3210
//
// Serves the single-page app in web/ and a small JSON API:
//   GET  /api/health           -> { status, llm, model }
//   GET  /api/sample           -> the bundled sample transcript (text)
//   POST /api/extract          -> { meta, result }  (Claude if available+requested, else deterministic)
//   POST /api/export/csv       -> text/csv of the action queue + RFP rows
//   POST /api/export/json      -> the result as a JSON download
//   POST /api/export/webhook   -> integration stub: returns the exact CRM payload
//                                  + a ready-to-run curl. Makes NO outbound call.

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

import { analyzeTranscript } from './engine.js';
import { analyzeWithClaude, llmConfigured, LlmUnavailable, DEFAULT_MODEL } from './llm.js';
import { judgeVerifiedRfpRows } from './judge.js';
import { verifyEvidenceGrounding } from './schema.js';
import { DealStore, DealStoreError, resetDealStore } from './deal-store.js';
import { LibraryStore, LibraryStoreError, MAX_LIBRARY_DOC_BYTES, resetLibraryStore } from './store.js';
import { TelemetryStore, resetTelemetryStore } from './telemetry-store.js';
import { seedDemoPack } from './demo-pack.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = Number(process.env.PORT || 3210);
const LIBRARY_DIR = process.env.SLIPSTREAM_DATA_DIR || join(ROOT, 'data', 'library');
const DEALS_DIR = process.env.SLIPSTREAM_DEALS_DIR || join(ROOT, 'data', 'deals');
const TELEMETRY_DIR = process.env.SLIPSTREAM_TELEMETRY_DIR || join(ROOT, 'data', 'telemetry');
// Bind address. Default 0.0.0.0 for portability; set HOST to a specific interface
// (e.g. the Tailscale IP) to keep the app off the public interface — private by binding.
const HOST = process.env.HOST || '0.0.0.0';
const libraryStore = new LibraryStore(LIBRARY_DIR);
const libraryReady = libraryStore.init();
const dealStore = new DealStore(DEALS_DIR);
const dealsReady = dealStore.init();
const telemetryStore = new TelemetryStore(TELEMETRY_DIR);
const telemetryReady = telemetryStore.init();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

function send(res, code, body, headers = {}) {
  res.writeHead(code, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
const sendJson = (res, code, obj, headers = {}) =>
  send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', ...headers });

function readBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) reject(new Error('payload too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function csvCell(v) {
  let s = String(v ?? '');
  // Neutralize spreadsheet formula injection (a cell starting with = + - @ tab/CR can execute).
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(result) {
  const rows = [[
    'type', 'title_or_question', 'detail', 'owner_or_status', 'priority',
    'answer_source', 'source_doc', 'source_section', 'source_line', 'source_quote',
    'transcript_line', 'transcript_quote',
  ]];
  for (const a of result.actions) {
    rows.push([
      'action', a.title, a.due || '', a.owner, a.priority,
      '', '', '', '', '',
      a.evidence?.line ?? '', a.evidence?.quote ?? '',
    ]);
  }
  for (const r of result.rfpRows) {
    rows.push([
      'rfp', r.question, r.suggestedAnswer, r.status, '',
      r.answerSource ?? 'none',
      r.libraryEvidence?.docName ?? '',
      r.libraryEvidence?.heading ?? '',
      r.libraryEvidence?.line ?? '',
      r.libraryEvidence?.quote ?? '',
      r.evidence?.line ?? '',
      r.evidence?.quote ?? '',
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}

// One integration target (the MVP's first stub): a CRM-shaped payload.
function crmPayload(result, meta) {
  return {
    source: 'slipstream',
    generatedAt: meta.generatedAt,
    grounded: meta.grounded,
    account: result.crmFields.Account || result.summary.dealName,
    fields: result.crmFields,
    nextStep: result.actions.find((a) => a.priority === 'P1')?.title || result.actions[0]?.title || '',
    openRequirements: result.requirements.map((r) => ({ category: r.category, text: r.text })),
    rfpSeed: result.rfpRows,
  };
}

async function serveStatic(res, urlPath) {
  // Map "/" -> web/index.html, "/web/x" or "/x.css" -> web/x
  let rel = urlPath === '/' ? 'web/index.html' : urlPath.replace(/^\//, '');
  if (!rel.startsWith('web/')) rel = `web/${rel}`;
  // basic traversal guard
  if (rel.includes('..')) return send(res, 400, 'bad path');
  try {
    const buf = await readFile(join(ROOT, rel));
    send(res, 200, buf, { 'Content-Type': MIME[extname(rel)] || 'application/octet-stream' });
  } catch {
    send(res, 404, 'not found');
  }
}

function jsonError(res, error) {
  if (!(error instanceof LibraryStoreError)) return false;
  sendJson(res, error.status, { error: error.message });
  return true;
}

function dealJsonError(res, error) {
  if (!(error instanceof DealStoreError)) return false;
  sendJson(res, error.status, { error: error.message });
  return true;
}

async function extractDealResult({ transcript = '', useLlm = false }) {
  if (!transcript.trim()) throw new Error('transcript is empty');

  await libraryReady;
  const started = Date.now();
  const libraryIndex = libraryStore.getIndex();
  const baseResult = analyzeTranscript(transcript, { libraryIndex });
  let result;
  let engine = 'deterministic';
  let model = null;
  let note = null;

  if (useLlm) {
    try {
      const out = await analyzeWithClaude(transcript, { libraryIndex });
      result = { ...out.result, rfpRows: baseResult.rfpRows };
      model = out.model;
      engine = 'claude';
    } catch (error) {
      if (!(error instanceof LlmUnavailable)) throw error;
      note = `Claude path unavailable (${error.message}); used the deterministic engine.`;
    }
  }
  if (!result) result = baseResult;
  result = verifyEvidenceGrounding(result, transcript, libraryIndex);

  let judged = false;
  if (useLlm && llmConfigured()) {
    const before = result.rfpRows.filter((row) => row.status === 'verified').length;
    await judgeVerifiedRfpRows(result, transcript);
    const after = result.rfpRows.filter((row) => row.status === 'verified').length;
    judged = true;
    if (after < before) note = `${note ? note + ' ' : ''}LLM judge downgraded ${before - after} RFP row(s) on semantic re-check.`;
  }

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      engine,
      model,
      grounded: true,
      judged,
      durationMs: Date.now() - started,
      note,
    },
    result,
  };
}

async function recordExportTelemetry(kind, dealId, result) {
  if (!dealId) return;
  await telemetryReady;
  const deal = dealStore.getDeal(dealId);
  await telemetryStore.record('export_clicked', {
    dealId,
    exportKind: kind,
    callCount: deal?.calls?.length || 0,
    actionCount: Array.isArray(result?.actions) ? result.actions.length : 0,
  });
}

async function buildDashboardSummary() {
  await dealsReady;
  await telemetryReady;
  const summary = await telemetryStore.summarize();
  return {
    ...summary,
    deals: summary.deals.map((entry) => {
      const deal = dealStore.getDeal(entry.dealId);
      return {
        ...entry,
        dealTitle: deal?.title || 'Unknown deal',
        account: deal?.account || '',
      };
    }),
  };
}

async function resetLocalData() {
  await Promise.all([libraryReady, dealsReady, telemetryReady]);
  await Promise.all([
    resetLibraryStore(LIBRARY_DIR),
    resetDealStore(DEALS_DIR),
    resetTelemetryStore(TELEMETRY_DIR),
  ]);
  await Promise.all([
    libraryStore.init(),
    dealStore.init(),
    telemetryStore.init(),
  ]);
}

async function loadDemoPack() {
  await resetLocalData();
  const seeded = await seedDemoPack({
    rootDir: ROOT,
    libraryStore,
    dealStore,
    telemetryStore,
    extractDealResult,
  });
  return {
    ...seeded,
    docs: libraryStore.listDocuments(),
    deals: dealStore.listDeals(),
    summaries: dealStore.listDealSummaries(),
    dashboard: await buildDashboardSummary(),
  };
}

const server = http.createServer(async (req, res) => {
  const { method } = req;
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    if (method === 'GET' && path === '/api/health') {
      await libraryReady;
      return sendJson(res, 200, { status: 'ok', llm: llmConfigured(), model: DEFAULT_MODEL });
    }

    if (method === 'GET' && path === '/api/sample') {
      const sampleName = url.searchParams.get('name') === 'followup'
        ? 'follow-up-call.txt'
        : 'discovery-call.txt';
      const txt = await readFile(join(ROOT, 'samples', sampleName), 'utf8');
      return send(res, 200, txt, { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    if (method === 'GET' && path === '/favicon.ico') {
      return send(res, 204, '', { 'Content-Type': 'image/x-icon' });
    }

    if (method === 'GET' && path === '/api/library') {
      await libraryReady;
      return sendJson(res, 200, { docs: libraryStore.listDocuments(), maxBytes: MAX_LIBRARY_DOC_BYTES });
    }

    if (method === 'GET' && path === '/api/dashboard') {
      return sendJson(res, 200, { summary: await buildDashboardSummary() });
    }

    if (method === 'GET' && path === '/api/deals') {
      await dealsReady;
      return sendJson(res, 200, { deals: dealStore.listDeals(), summaries: dealStore.listDealSummaries() });
    }

    if (method === 'POST' && path === '/api/demo/load') {
      return sendJson(res, 200, await loadDemoPack());
    }

    if (method === 'POST' && path === '/api/demo/reset') {
      await resetLocalData();
      return sendJson(res, 200, {
        reset: true,
        deals: dealStore.listDeals(),
        summaries: dealStore.listDealSummaries(),
        docs: libraryStore.listDocuments(),
        dashboard: await buildDashboardSummary(),
      });
    }

    if (method === 'POST' && path === '/api/deals') {
      await dealsReady;
      let body;
      try {
        body = JSON.parse((await readBody(req)) || '{}');
      } catch {
        return sendJson(res, 400, { error: 'invalid JSON body' });
      }
      try {
        const deal = await dealStore.createDeal(body);
        return sendJson(res, 200, { deal, deals: dealStore.listDeals(), summaries: dealStore.listDealSummaries() });
      } catch (error) {
        if (dealJsonError(res, error)) return;
        throw error;
      }
    }

    if (method === 'GET' && path.startsWith('/api/deals/')) {
      await dealsReady;
      const dealId = decodeURIComponent(path.slice('/api/deals/'.length));
      const deal = dealStore.getDeal(dealId);
      if (!deal) return sendJson(res, 404, { error: 'deal not found' });
      return sendJson(res, 200, { deal, view: dealStore.buildView(dealId) });
    }

    if (method === 'POST' && path.endsWith('/return') && path.startsWith('/api/deals/')) {
      await dealsReady;
      await telemetryReady;
      const dealId = decodeURIComponent(path.slice('/api/deals/'.length, -'/return'.length));
      const deal = dealStore.getDeal(dealId);
      if (!deal) return sendJson(res, 404, { error: 'deal not found' });
      await telemetryStore.record('deal_returned', {
        dealId,
        callCount: deal.calls.length,
      });
      return sendJson(res, 200, {
        deal,
        deals: dealStore.listDeals(),
        summaries: dealStore.listDealSummaries(),
        view: dealStore.buildView(dealId),
      });
    }

    if (method === 'POST' && path.endsWith('/calls') && path.startsWith('/api/deals/')) {
      await dealsReady;
      await telemetryReady;
      let body;
      try {
        body = JSON.parse((await readBody(req)) || '{}');
      } catch {
        return sendJson(res, 400, { error: 'invalid JSON body' });
      }
      const dealId = decodeURIComponent(path.slice('/api/deals/'.length, -'/calls'.length));
      try {
        const data = await extractDealResult(body);
        const deal = await dealStore.addCall(dealId, {
          transcript: body.transcript,
          label: body.label,
          meta: data.meta,
          result: data.result,
        });
        const latestCall = deal.calls[deal.calls.length - 1];
        await telemetryStore.record('call_processed', {
          dealId,
          callId: latestCall?.id || null,
          callLabel: latestCall?.label || null,
          callCount: deal.calls.length,
          engine: data.meta.engine,
          model: data.meta.model,
        });
        return sendJson(res, 200, {
          deal,
          deals: dealStore.listDeals(),
          summaries: dealStore.listDealSummaries(),
          view: dealStore.buildView(dealId),
        });
      } catch (error) {
        if (String(error?.message || '').includes('transcript is empty')) return sendJson(res, 400, { error: error.message });
        if (dealJsonError(res, error)) return;
        throw error;
      }
    }

    if (method === 'POST' && path === '/api/library') {
      await libraryReady;
      let body;
      try {
        body = JSON.parse((await readBody(req, MAX_LIBRARY_DOC_BYTES + 50_000)) || '{}');
      } catch (error) {
        if (String(error?.message || '').includes('payload too large')) return sendJson(res, 413, { error: error.message });
        throw error;
      }
      try {
        const doc = await libraryStore.addDocument(body);
        return sendJson(res, 200, { doc, docs: libraryStore.listDocuments() });
      } catch (error) {
        if (jsonError(res, error)) return;
        throw error;
      }
    }

    if (method === 'DELETE' && path.startsWith('/api/library/')) {
      await libraryReady;
      const docId = decodeURIComponent(path.slice('/api/library/'.length));
      const deleted = await libraryStore.deleteDocument(docId);
      return sendJson(res, deleted ? 200 : 404, deleted ? { deleted: true, docs: libraryStore.listDocuments() } : { error: 'document not found' });
    }

    if (method === 'POST' && path === '/api/extract') {
      let body;
      try {
        body = JSON.parse((await readBody(req)) || '{}');
      } catch {
        return sendJson(res, 400, { error: 'invalid JSON body' });
      }
      try {
        return sendJson(res, 200, await extractDealResult(body));
      } catch (error) {
        if (String(error?.message || '').includes('transcript is empty')) return sendJson(res, 400, { error: error.message });
        throw error;
      }
    }

    if (method === 'POST' && path === '/api/export/csv') {
      const { result, dealId } = JSON.parse((await readBody(req)) || '{}');
      if (!result) return sendJson(res, 400, { error: 'missing result' });
      await recordExportTelemetry('csv', dealId, result);
      return send(res, 200, toCsv(result), {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="slipstream-actions.csv"',
      });
    }

    if (method === 'POST' && path === '/api/export/json') {
      const body = JSON.parse((await readBody(req)) || '{}');
      await recordExportTelemetry('json', body.dealId, body.result);
      const { dealId, ...exportBody } = body;
      if (exportBody.head && typeof exportBody.head === 'object') delete exportBody.head.dealId;
      return send(res, 200, JSON.stringify(exportBody, null, 2), {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="slipstream-deal.json"',
      });
    }

    if (method === 'POST' && path === '/api/export/webhook') {
      // Integration stub. We intentionally do NOT make an outbound request —
      // instead we return the exact payload and a ready-to-run curl so the user
      // (or a server-side job, later) can deliver it to HubSpot/Salesforce/Slack.
      const { result, meta = {}, dealId, url: target = 'https://example.com/webhook' } =
        JSON.parse((await readBody(req)) || '{}');
      if (!result) return sendJson(res, 400, { error: 'missing result' });
      await recordExportTelemetry('webhook', dealId, result);
      const payload = crmPayload(result, meta);
      const curl =
        `curl -X POST ${target} \\\n  -H 'content-type: application/json' \\\n  -d '` +
        JSON.stringify(payload).replace(/'/g, `'\\''`) +
        `'`;
      return sendJson(res, 200, { delivered: false, target, payload, curl });
    }

    if (method === 'GET') return serveStatic(res, path);
    return send(res, 405, 'method not allowed');
  } catch (e) {
    return sendJson(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Slipstream running →  http://${HOST}:${PORT}`);
  console.log(`  Claude enrichment: ${llmConfigured() ? `on (${DEFAULT_MODEL})` : 'off (deterministic engine)'}`);
});

export { server, toCsv, crmPayload };
