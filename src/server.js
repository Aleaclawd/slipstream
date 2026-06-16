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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PORT = Number(process.env.PORT || 3210);
// Bind address. Default 0.0.0.0 for portability; set HOST to a specific interface
// (e.g. the Tailscale IP) to keep the app off the public interface — private by binding.
const HOST = process.env.HOST || '0.0.0.0';

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
  const rows = [['type', 'title_or_question', 'detail', 'owner_or_status', 'priority', 'evidence_line', 'evidence_quote']];
  for (const a of result.actions) {
    rows.push(['action', a.title, a.due || '', a.owner, a.priority, a.evidence?.line ?? '', a.evidence?.quote ?? '']);
  }
  for (const r of result.rfpRows) {
    rows.push(['rfp', r.question, r.suggestedAnswer, r.status, '', r.evidence?.line ?? '', r.evidence?.quote ?? '']);
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

const server = http.createServer(async (req, res) => {
  const { method } = req;
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  try {
    if (method === 'GET' && path === '/api/health') {
      return sendJson(res, 200, { status: 'ok', llm: llmConfigured(), model: DEFAULT_MODEL });
    }

    if (method === 'GET' && path === '/api/sample') {
      const txt = await readFile(join(ROOT, 'samples/discovery-call.txt'), 'utf8');
      return send(res, 200, txt, { 'Content-Type': 'text/plain; charset=utf-8' });
    }

    if (method === 'POST' && path === '/api/extract') {
      const { transcript = '', useLlm = false } = JSON.parse((await readBody(req)) || '{}');
      if (!transcript.trim()) return sendJson(res, 400, { error: 'transcript is empty' });

      const started = Date.now();
      let result;
      let engine = 'deterministic';
      let model = null;
      let note = null;

      if (useLlm) {
        try {
          const out = await analyzeWithClaude(transcript);
          result = out.result;
          model = out.model;
          engine = 'claude';
        } catch (e) {
          if (!(e instanceof LlmUnavailable)) throw e;
          note = `Claude path unavailable (${e.message}); used the deterministic engine.`;
        }
      }
      if (!result) result = analyzeTranscript(transcript);

      const meta = {
        generatedAt: new Date().toISOString(),
        engine,
        model,
        grounded: true,
        durationMs: Date.now() - started,
        note,
      };
      return sendJson(res, 200, { meta, result });
    }

    if (method === 'POST' && path === '/api/export/csv') {
      const { result } = JSON.parse((await readBody(req)) || '{}');
      if (!result) return sendJson(res, 400, { error: 'missing result' });
      return send(res, 200, toCsv(result), {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="slipstream-actions.csv"',
      });
    }

    if (method === 'POST' && path === '/api/export/json') {
      const body = JSON.parse((await readBody(req)) || '{}');
      return send(res, 200, JSON.stringify(body, null, 2), {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="slipstream-deal.json"',
      });
    }

    if (method === 'POST' && path === '/api/export/webhook') {
      // Integration stub. We intentionally do NOT make an outbound request —
      // instead we return the exact payload and a ready-to-run curl so the user
      // (or a server-side job, later) can deliver it to HubSpot/Salesforce/Slack.
      const { result, meta = {}, url: target = 'https://example.com/webhook' } =
        JSON.parse((await readBody(req)) || '{}');
      if (!result) return sendJson(res, 400, { error: 'missing result' });
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
