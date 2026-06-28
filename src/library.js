const STOP = new Set([
  'the', 'and', 'with', 'need', 'would', 'that', 'this', 'your', 'our', 'their', 'from', 'have',
  'will', 'about', 'into', 'what', 'when', 'where', 'which', 'there', 'they', 'them', 'then', 'than',
  'also', 'some', 'more', 'most', 'very', 'just', 'like', 'make', 'made', 'does', 'done', 'both',
  'each', 'only', 'over', 'must', 'able', 'want', 'take', 'give', 'data', 'call', 'team', 'time',
  'plan', 'help', 'sure', 'okay', 'good', 'great', 'thanks', 'yes', 'are', 'was', 'were', 'has',
  'its', 'for', 'but', 'not', 'all', 'any', 'get', 'can', 'you', 'use', 'via', 'per', 'out', 'now',
  'one', 'two', 'too', 'let', 'see', 'say', 'set', 'run', 'day', 'is', 'meet', 'support', 'state',
  'flag', 'confirm', 'product', 'gap', 'draft', 'please', 'question', 'security', 'compliance', 'we',
  'integration', 'scale', 'performance',
]);

const CATEGORY_RE = {
  security: /SOC 2|\bSSO\b|SAML|Okta|residency|compliance|encryption|security|privacy|ISO 27001/i,
  integration: /integrate|integration|Snowflake|Slack|\bAPI\b|webhook|write[ -]?back|REST|connector/i,
  scale: /per day|per hour|per second|per minute|latency|throughput|\bscale\b|within (?:a|one|\d|a few) minutes?|\bpeak\b|\bspikes?\b|\b\d[\d,.]*\s*[kmb]?\s*(?:events|records|rows|requests|messages|transactions|qps|rps|tps|users|calls)\b|\b\d[\d,.]*\s*[kmb]\b\s*(?:\/|per\b)|\b(?:million|thousand|billion)\s+(?:events|records|rows|requests|messages|transactions)/i,
};

export const LIBRARY_THRESHOLD = 1.8;

function stem(token) {
  return token.length > 4 && token.endsWith('s') ? token.slice(0, -1) : token;
}

function tokenize(text) {
  return (String(text || '').toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .map(stem)
    .filter((token) => token.length >= 2 && !STOP.has(token));
}

function normalizeLineBreaks(text) {
  return String(text || '').replace(/\r\n?/g, '\n');
}

function finalizePassage(passages, docId, docName, heading, lines, startLine) {
  const cleaned = [...lines];
  let lineOffset = 0;
  while (cleaned.length && !cleaned[0].trim()) {
    cleaned.shift();
    lineOffset++;
  }
  while (cleaned.length && !cleaned[cleaned.length - 1].trim()) cleaned.pop();
  const text = cleaned.join('\n').trim();
  if (!text) return;
  const ordinal = passages.length + 1;
  passages.push({
    docId,
    docName,
    passageId: `${docId}:${ordinal}`,
    heading: heading || `Section ${ordinal}`,
    line: startLine + lineOffset,
    text,
  });
}

function parseHeadingSections(docId, docName, lines) {
  const passages = [];
  let heading = 'Document body';
  let bucket = [];
  let startLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const match = /^\s{0,3}#{1,6}\s+(.+?)\s*$/.exec(raw);
    if (match) {
      finalizePassage(passages, docId, docName, heading, bucket, startLine);
      heading = match[1].trim() || `Section ${passages.length + 1}`;
      bucket = [];
      startLine = i + 2;
      continue;
    }
    bucket.push(raw);
  }

  finalizePassage(passages, docId, docName, heading, bucket, startLine);
  return passages;
}

function parseParagraphs(docId, docName, lines) {
  const passages = [];
  let bucket = [];
  let startLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!bucket.length && raw.trim()) startLine = i + 1;
    if (!raw.trim()) {
      finalizePassage(passages, docId, docName, `Section ${passages.length + 1}`, bucket, startLine);
      bucket = [];
      continue;
    }
    bucket.push(raw);
  }

  finalizePassage(passages, docId, docName, `Section ${passages.length + 1}`, bucket, startLine);
  return passages;
}

export function parseDoc(name, text, options = {}) {
  const docName = String(name || 'Untitled document').trim() || 'Untitled document';
  const docId = String(options.docId || 'doc');
  const lines = normalizeLineBreaks(text).split('\n');
  const hasHeadings = lines.some((line) => /^\s{0,3}#{1,6}\s+/.test(line));
  const passages = hasHeadings
    ? parseHeadingSections(docId, docName, lines)
    : parseParagraphs(docId, docName, lines);

  return { docId, docName, passages };
}

function categoryBoost(category, passage) {
  if (!category || !CATEGORY_RE[category]) return 0;
  return CATEGORY_RE[category].test(`${passage.heading}\n${passage.text}`) ? 1.35 : 0;
}

function headingBoost(queryTokens, passageTokens, headingTokens) {
  if (!headingTokens.length) return 0;
  const unique = new Set(queryTokens);
  let matches = 0;
  for (const token of unique) {
    if (headingTokens.includes(token)) matches++;
  }
  if (!matches) return 0;
  return Math.min(0.8, matches * 0.25 + (passageTokens.length ? 0.15 : 0));
}

export function buildIndex(docs = []) {
  const passages = [];
  const docSummaries = [];

  for (const doc of docs) {
    const parsed = parseDoc(doc.docName || doc.name, doc.text || '', { docId: doc.docId || doc.id || 'doc' });
    const expanded = parsed.passages.map((passage) => {
      const tokens = tokenize(`${passage.heading}\n${passage.text}`);
      const termFreq = {};
      tokens.forEach((token) => { termFreq[token] = (termFreq[token] || 0) + 1; });
      return {
        ...passage,
        tokens,
        headingTokens: tokenize(passage.heading),
        termFreq,
      };
    });
    passages.push(...expanded);
    docSummaries.push({
      docId: parsed.docId,
      docName: parsed.docName,
      createdAt: doc.createdAt || null,
      passageCount: expanded.length,
    });
  }

  const df = {};
  for (const passage of passages) {
    for (const token of new Set(passage.tokens)) df[token] = (df[token] || 0) + 1;
  }

  const passageCount = passages.length || 1;
  const idf = Object.fromEntries(
    Object.entries(df).map(([token, freq]) => [token, Math.log(1 + passageCount / freq)])
  );

  return {
    docs: docSummaries,
    passages,
    passagesById: Object.fromEntries(passages.map((passage) => [passage.passageId, passage])),
    idf,
  };
}

export function retrieve(index, queryText, options = {}) {
  const queryTokens = tokenize(queryText);
  if (!index?.passages?.length || !queryTokens.length) return null;

  const threshold = Number.isFinite(options.threshold) ? options.threshold : LIBRARY_THRESHOLD;
  const scored = [];

  for (const passage of index.passages) {
    let score = 0;
    for (const token of new Set(queryTokens)) {
      if (passage.termFreq[token]) score += passage.termFreq[token] * (index.idf[token] || 0);
    }
    if (!score) continue;
    score += categoryBoost(options.category, passage);
    score += headingBoost(queryTokens, passage.tokens, passage.headingTokens);
    if (score >= threshold) scored.push({ passage, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  if (!top) return null;

  return {
    docId: top.passage.docId,
    docName: top.passage.docName,
    passageId: top.passage.passageId,
    heading: top.passage.heading,
    quote: top.passage.text,
    line: top.passage.line,
    score: Number(top.score.toFixed(3)),
  };
}
