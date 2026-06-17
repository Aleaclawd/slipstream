// engine.js — deterministic, zero-dependency transcript extraction engine
import { emptyResult, normalizeResult, MEDDPICC_DIMENSIONS } from './schema.js';

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse a transcript text into an array of utterance objects.
 * Each utterance: { lineNo, ts, speaker, role, org, text, raw }
 *
 * Supported line shapes:
 *   "[00:41] Dan (VP Engineering, Northwind): text..."
 *   "Dan: text..."
 *   "plain line with no speaker"
 */
function parseTranscript(text) {
  const lines = text.split('\n');
  const utterances = [];

  // Pattern 1: [HH:MM] Speaker (Role, Org): text
  const FULL_RE = /^\[(\d{2}:\d{2})\]\s+([^(]+?)\s+\(([^,)]+),\s*([^)]+)\):\s*(.*)$/;
  // Pattern 2: Speaker: text  (no timestamp, no role)
  const SIMPLE_RE = /^([A-Z][A-Za-z\s']+?):\s*(.+)$/;

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1; // 1-based
    const raw = lines[i];
    const trimmed = raw.trim();

    let m;
    if ((m = FULL_RE.exec(trimmed))) {
      utterances.push({
        lineNo,
        ts: m[1],
        speaker: m[2].trim(),
        role: m[3].trim(),
        org: m[4].trim(),
        text: m[5].trim(),
        raw: trimmed,
      });
    } else if ((m = SIMPLE_RE.exec(trimmed))) {
      utterances.push({
        lineNo,
        ts: null,
        speaker: m[1].trim(),
        role: null,
        org: null,
        text: m[2].trim(),
        raw: trimmed,
      });
    } else {
      utterances.push({
        lineNo,
        ts: null,
        speaker: null,
        role: null,
        org: null,
        text: trimmed,
        raw: trimmed,
      });
    }
  }

  return utterances;
}

/** Build an Evidence object from an utterance. */
function mkEvidence(u) {
  return {
    quote: u.raw || u.text,
    line: u.lineNo,
    speaker: u.speaker,
    ts: u.ts,
  };
}

// ─── Heuristics ──────────────────────────────────────────────────────────────

// Bare "pain"/"hard" are too weak (they catch an SE asking "where's the pain"),
// so we key on concrete difficulty signals instead.
const PAIN_SIGNALS = /killing us|problem|manual|by hand|eats|full time|get it wrong|non-starter|burned|struggle/i;
const HIGH_SEVERITY = /most need|killing|non-starter|this quarter|burned/i;

// "push" must be an integration push (alerts/notifications/to a system), not "we push 10M rows";
// API/SSO are word-bounded so they don't fire inside "rapidly"/"lesson".
const INTEGRATION_RE = /integrate|Snowflake|Slack|\bAPI\b|webhook|write[ -]?back|push (?:alert|notif|to|into)/i;
const SECURITY_RE = /SOC 2|\bSSO\b|Okta|residency|compliance|encryption|no customer data/i;
// Bare "events" matched any mention of events (incl. pains); require a real rate/volume/latency.
const SCALE_RE = /per day|per hour|latency|throughput|\bscale\b|within (?:a|one|\d|a few) minutes?|\bpeak\b|\b(?:million|thousand|billion)\s+(?:events|records|rows|requests|messages|transactions)/i;
const COMMERCIAL_RE = /budget|ROI|CFO|pricing|cost/i;

const OBJECTION_RE = /concern|worried|whether a startup|burned|non-starter|risk/i;

const ACTION_RE = /I'll|let me|we'd need|need to|can we get|send|confirm|line up|add/i;
const SE_ACTION_RE = /^(I'll|let me)/i;
// A real commitment/ask, not just a pain that happens to contain "need to".
const COMMIT_RE = /I'll|let me|can we get|we'd need|send|confirm|line up|please|let's|\badd\b/i;
const P1_RE = /POC|non-starter|security pack|this quarter/i;
const TIMEFRAME_RE = /\btwo weeks?\b|\bone week?\b|\bnext week\b|\bthis week\b|\bone month\b/i;

const COMPETITOR_NAMES = [
  { pattern: /\bGong\b/i, name: 'Gong' },
  { pattern: /\bClari\b/i, name: 'Clari' },
  { pattern: /\bKafka\b/i, name: 'Kafka' },
  { pattern: /\bin[- ]house\b/i, name: 'in-house' },
  { pattern: /\bbuild it\b/i, name: 'build-it-in-house' },
];

// ─── Main export ─────────────────────────────────────────────────────────────

export function analyzeTranscript(text) {
  const utterances = parseTranscript(text);
  const result = emptyResult();

  // ── Summary ──
  // The seller's own rep (SE): detected by role, else the first speaker. Used to attribute
  // commitments, pick the prospect org, and sign the follow-up — never hardcoded to a sample name.
  const seByRole =
    utterances.find((u) => /\b(SE|sales eng|solutions?\s*(consultant|engineer|architect)|account exec|\bAE\b)\b/i.test(u.role || ''))?.speaker || '';
  const seSpeaker = seByRole || utterances.find((u) => u.speaker)?.speaker || '';
  // Account = the PROSPECT org: first org from a speaker who isn't the SE (the SE's own org
  // would otherwise win just by speaking first). Fall back to any org, then "Unknown".
  const firstOrg =
    utterances.find((u) => u.org && u.speaker && u.speaker !== seSpeaker)?.org ||
    utterances.find((u) => u.org)?.org ||
    'Unknown';
  result.summary.dealName = `${firstOrg} — Slipstream Evaluation`;
  // oneLiner is derived from the lead pain after extraction (below).

  // ── Stakeholders ──
  const seenSpeakers = new Map(); // name -> utterance of first appearance
  for (const u of utterances) {
    if (u.speaker && u.role && !seenSpeakers.has(u.speaker)) {
      seenSpeakers.set(u.speaker, u);
    }
  }
  for (const [name, u] of seenSpeakers) {
    result.stakeholders.push({ name, role: u.role, evidence: mkEvidence(u) });
  }

  // ── Pains ──
  for (const u of utterances) {
    if (PAIN_SIGNALS.test(u.text)) {
      const severity = HIGH_SEVERITY.test(u.text) ? 'high' : 'med';
      result.pains.push({
        text: u.text.slice(0, 120),
        severity,
        evidence: mkEvidence(u),
      });
    }
  }

  // oneLiner: derived from the lead (high-severity) pain — never hardcoded to a sample.
  const leadPain = result.pains.find((p) => p.severity === 'high') || result.pains[0];
  result.summary.oneLiner = leadPain
    ? `${firstOrg}: ${trimText(leadPain.text, 100)}`
    : `${firstOrg} — technical evaluation in progress.`;

  // ── Requirements ── (the prospect's needs — not the SE's confirmations)
  const requirementSeen = new Set();
  // A concrete-need signal: lets a line that's also an objection ("…it's a non-starter")
  // still count as a requirement, while a pure worry does not.
  const NEED_RE = /\bneed\b|\brequire|\bmust\b|non-starter|have to|integrate|write[ -]?back|\bpush\b|\bSSO\b|residency|certif|\bsupport/i;
  for (const u of utterances) {
    if (!u.text) continue;
    // Requirements come from the prospect; skip the SE's own lines (their confirmations are
    // handled separately, as RFP verification). Only skip when we identified the SE by role.
    if (seByRole && u.speaker === seByRole) continue;
    // A line that is purely an objection/worry is captured as an objection, not a requirement —
    // unless it also states a concrete need.
    const objectionOnly = OBJECTION_RE.test(u.text) && !NEED_RE.test(u.text);
    const key = (cat) => `${cat}:${u.lineNo}`;
    let classified = false;
    const add = (category) => {
      requirementSeen.add(key(category));
      classified = true;
      result.requirements.push({ category, text: deriveRequirementText(category, u.text), evidence: mkEvidence(u) });
    };
    if (!objectionOnly && INTEGRATION_RE.test(u.text) && !requirementSeen.has(key('integration'))) add('integration');
    if (!objectionOnly && SECURITY_RE.test(u.text) && !requirementSeen.has(key('security'))) add('security');
    if (!objectionOnly && SCALE_RE.test(u.text) && !requirementSeen.has(key('scale'))) add('scale');
    if (!objectionOnly && COMMERCIAL_RE.test(u.text) && !requirementSeen.has(key('commercial'))) add('commercial');
    // Open questions: only if the line wasn't already captured as a concrete requirement.
    if (!classified && u.text.trimEnd().endsWith('?') && !requirementSeen.has(key('open_question'))) {
      requirementSeen.add(key('open_question'));
      result.requirements.push({ category: 'open_question', text: trimText(u.text, 120), evidence: mkEvidence(u) });
    }
  }

  // ── Objections ──
  for (const u of utterances) {
    if (OBJECTION_RE.test(u.text)) {
      result.objections.push({ text: u.text.slice(0, 120), evidence: mkEvidence(u) });
    }
  }

  // ── Competitors ──
  const seenCompetitors = new Set();
  for (const u of utterances) {
    for (const { pattern, name } of COMPETITOR_NAMES) {
      if (pattern.test(u.text) && !seenCompetitors.has(name)) {
        seenCompetitors.add(name);
        result.competitors.push({ name, evidence: mkEvidence(u) });
      }
    }
  }

  // ── Actions ──
  for (const u of utterances) {
    if (ACTION_RE.test(u.text)) {
      // A pain statement that merely contains "need to" is not an action.
      if (PAIN_SIGNALS.test(u.text) && !COMMIT_RE.test(u.text)) continue;
      const isSELine = Boolean(seSpeaker) && u.speaker === seSpeaker;
      const startsWithSE = SE_ACTION_RE.test(u.text);
      const owner = isSELine || startsWithSE ? 'SE' : 'Prospect';
      const priority = P1_RE.test(u.text) ? 'P1' : 'P2';
      const tm = TIMEFRAME_RE.exec(u.text);
      const due = tm ? tm[0] : '';
      result.actions.push({
        title: deriveActionTitle(u.text),
        owner,
        due,
        priority,
        evidence: mkEvidence(u),
      });
    }
  }

  // ── demoPrep ──
  const secReqs = result.requirements.filter((r) => r.category === 'security');
  const intReqs = result.requirements.filter((r) => r.category === 'integration');
  const scaleReqs = result.requirements.filter((r) => r.category === 'scale');
  const pocAction = result.actions.find((a) => /POC|proof of concept/i.test(a.title + (a.evidence?.quote ?? '')));

  const demoPrepItems = [];
  const PREP_LABEL = {
    security: 'Prepare security & compliance evidence',
    integration: 'Build a live integration demo',
    scale: 'Prepare a scale / architecture answer',
  };
  // Derive each prep item from the actual requirement the prospect raised — no fixed
  // SOC 2 / Snowflake / 50M assumptions (those only applied to the first sample).
  for (const r of [...secReqs, ...intReqs, ...scaleReqs]) {
    demoPrepItems.push({
      item: `${PREP_LABEL[r.category] || 'Prepare a response'} — ${trimText(r.text, 90)}`,
      rationale: `Raised as a ${r.category} requirement on the call.`,
      evidence: r.evidence,
    });
  }
  if (pocAction) {
    demoPrepItems.push({
      item: `Scope and schedule the requested POC / next step`,
      rationale: `A working proof-of-concept on their own data was explicitly requested.`,
      evidence: pocAction.evidence,
    });
  }
  // Cap at 6
  result.demoPrep = demoPrepItems.slice(0, 6);

  // ── rfpRows ──
  // SE utterances that confirmed something
  const SE_CONFIRM_RE = /supported|confirm|I'll get you/i;
  const seConfirmations = utterances.filter(
    (u) => u.speaker && u.speaker === seSpeaker && SE_CONFIRM_RE.test(u.text)
  );

  const allRfpSourceReqs = [...secReqs, ...intReqs, ...scaleReqs];
  for (const r of allRfpSourceReqs) {
    // Match against the requirement's spoken text — NOT the raw quote, whose speaker tag
    // ("Security Lead, …") would spuriously match an SE line that mentions "security".
    const confirmed = seConfirmations.find((seU) =>
      sharesKeywords(seU.text, r.text)
    );
    result.rfpRows.push({
      question: rfpQuestion(r),
      suggestedAnswer: confirmed ? `Confirmed on the call: "${trimText(confirmed.text, 100)}"` : rfpAnswer(r),
      status: confirmed ? 'verified' : 'unverified',
      evidence: confirmed ? mkEvidence(confirmed) : r.evidence,
    });
  }

  // ── crmFields ──
  const champion = result.stakeholders.find((s) =>
    /VP|Director|Head|Lead|Data Eng/i.test(s.role)
  ) ?? result.stakeholders[0];
  const economicBuyer = findEconomicBuyer(utterances);
  const topP1 = result.actions.find((a) => a.priority === 'P1');

  result.crmFields = {
    Account: firstOrg,
    Champion: champion?.name ?? '',
    EconomicBuyer: economicBuyer ?? '',
    Competitor: [...seenCompetitors].join(', '),
    NextStep: topP1?.title ?? result.actions[0]?.title ?? '',
    DealStage: 'Technical Evaluation',
  };

  // ── followupEmail ── assembled from what was actually extracted; every claim cites a
  // transcript line; signed with the detected SE. Nothing here is hardcoded to a sample,
  // and it never asserts a fact that isn't in the call.
  const highPains = result.pains.filter((p) => p.severity === 'high');
  const topPain = highPains[0] ?? result.pains[0];
  const seActions = result.actions.filter((a) => a.owner === 'SE');
  const account = firstOrg;
  const champName = champion?.name ?? 'there';

  const citations = [];
  const cite = (ev) => {
    if (!ev) return '';
    citations.push(ev);
    return ` [${citations.length}]`;
  };

  const para = [`Hi ${champName},`, '', 'Thanks for the time today — a quick recap and the next steps.'];
  if (topPain) {
    para.push('', `The priority you raised: ${trimText(topPain.text, 140)}${cite(topPain.evidence)}.`);
  }
  const namedReqs = result.requirements.filter((r) => r.category !== 'open_question').slice(0, 4);
  if (namedReqs.length) {
    para.push('', 'Requirements we captured to address:');
    for (const r of namedReqs) para.push(`  • ${trimText(r.text, 100)}${cite(r.evidence)}`);
  }
  if (seActions.length) {
    para.push('', 'What I will follow up on:');
    for (const a of seActions.slice(0, 5)) para.push(`  • ${trimText(a.title, 90)}${a.due ? ` (${a.due})` : ''}${cite(a.evidence)}`);
  }
  if (economicBuyer) {
    para.push('', `It would also be good to bring ${economicBuyer} (budget owner) into the next conversation.`);
  }
  para.push('', 'If I have mis-stated anything above, just flag it and I will correct it.', '', 'Best,', seSpeaker || '[your name]');
  if (citations.length) {
    para.push('', '—', ...citations.map((ev, idx) => `[${idx + 1}] line ${ev.line}: ${trimText(ev.quote, 100)}`));
  }

  result.followupEmail = {
    subject: `${account} × Slipstream — next steps`,
    body: para.join('\n'),
  };

  // ── MVP intelligence: deal health (MEDDPICC), risks, next-best-actions, battlecards, analytics ──
  const findU = (re) => utterances.find((u) => re.test(u.text));
  const evOf = (u) => (u ? mkEvidence(u) : null);
  const metricU = findU(/two analysts|50 million|\b\d+\s*(million|analysts|engineers|events)|\bROI\b/i);
  const ebU = findU(/\bCFO\b|budget|economic buyer/i);
  const pocU = findU(/\bPOC\b|proof of concept|two weeks|evaluation|that would move/i);
  const paperU = findU(/SOC 2|data residency|compliance|procurement|legal|data-processing|security bar/i);
  const champU = findU(/most need|fix this quarter|move this forward|show us a working/i);
  const reqCount = result.requirements.length;
  const highPainCount = highPains.length;
  const has = (c, hi, lo) => (c ? hi : lo);
  const dimScore = {
    metrics: has(metricU, 80, 35),
    economic_buyer: has(economicBuyer || ebU, 80, 25),
    decision_criteria: Math.min(90, 40 + reqCount * 8),
    decision_process: has(pocU, 80, 40),
    paper_process: has(paperU, 70, 30),
    identified_pain: Math.min(95, 45 + highPainCount * 15),
    champion: has(champU, 78, 42),
    competition: has(seenCompetitors.size > 0, 70, 50),
  };
  const dimEvidence = {
    metrics: evOf(metricU),
    economic_buyer: evOf(ebU),
    decision_criteria: result.requirements[0]?.evidence ?? null,
    decision_process: evOf(pocU),
    paper_process: evOf(paperU),
    identified_pain: (highPains[0] ?? result.pains[0])?.evidence ?? null,
    champion: evOf(champU),
    competition: result.competitors[0]?.evidence ?? null,
  };
  const dimNotes = {
    metrics: metricU ? 'Quantified business impact captured.' : 'No quantified business metric yet.',
    economic_buyer: economicBuyer || ebU ? `Economic buyer in play${economicBuyer ? ': ' + economicBuyer : ''}.` : 'No economic buyer identified.',
    decision_criteria: reqCount ? `${reqCount} technical requirements surfaced.` : 'Decision criteria still unclear.',
    decision_process: pocU ? 'POC / evaluation path discussed.' : 'Decision process not yet mapped.',
    paper_process: paperU ? 'Security / compliance steps named.' : 'Procurement / paper process unknown.',
    identified_pain: highPainCount ? `${highPainCount} high-severity pain(s) identified.` : 'Pain not strongly established.',
    champion: champU ? 'An engaged internal advocate is pushing the deal.' : 'No clear champion yet.',
    competition: seenCompetitors.size ? `Competition known: ${[...seenCompetitors].join(', ')}.` : 'Competitive landscape unknown.',
  };
  const dimensions = MEDDPICC_DIMENSIONS.map((d) => ({ key: d.key, label: d.label, score: dimScore[d.key], note: dimNotes[d.key], evidence: dimEvidence[d.key] }));
  result.dealHealth = { score: Math.round(dimensions.reduce((n, d) => n + d.score, 0) / dimensions.length), dimensions };

  const risks = [];
  const pushRisk = (text, severity, evidence) => { if (text && !risks.some((r) => r.text === text)) risks.push({ text, severity, evidence: evidence ?? null }); };
  for (const o of result.objections) pushRisk(o.text.slice(0, 140), /non-starter|burned|can a startup|security bar/i.test(o.text) ? 'high' : 'med', o.evidence);
  for (const d of dimensions) if (d.score < 40) pushRisk(`${d.label} gap — ${d.note}`, d.key === 'economic_buyer' || d.key === 'paper_process' ? 'high' : 'med', d.evidence);
  if (seenCompetitors.size) pushRisk(`Competitive evaluation vs ${[...seenCompetitors].join(', ')}`, 'med', result.competitors[0]?.evidence);
  result.risks = risks;

  const nba = [];
  const addNba = (action, rationale, priority, evidence) => nba.push({ action, rationale, priority, evidence: evidence ?? null });
  if (!(economicBuyer || ebU)) addNba('Multithread to the economic buyer (CFO / budget owner)', 'No economic buyer is engaged yet — enterprise deals stall in procurement without one.', 'P1', null);
  else if (ebU) addNba(`Get ${economicBuyer || 'the economic buyer'} engaged on the next call`, 'Budget owner is named but not yet bought into the technical value.', 'P2', evOf(ebU));
  if (paperU || result.requirements.some((r) => r.category === 'security')) addNba('Send the security & compliance pack (overview + DPA) and pre-fill the security questionnaire', 'A security/compliance bar was raised — de-risk it early to avoid late-stage paper-process death.', 'P1', evOf(paperU));
  if (result.requirements.some((r) => /write.?back/i.test(r.text + (r.evidence?.quote || '')))) addNba('Confirm data write-back feasibility before the POC', 'Write-back was flagged a non-starter — validate it before investing in the POC.', 'P1', null);
  if (pocU) addNba('Scope a 2-week POC on their own data', 'A working POC on their data was explicitly requested and would move the deal forward.', 'P1', evOf(pocU));
  for (const name of seenCompetitors) addNba(`Prepare a battlecard vs ${name}`, `${name} is in the evaluation — arm the champion with crisp differentiation.`, 'P2', result.competitors.find((c) => c.name === name)?.evidence);
  result.nextBestActions = nba;

  const angles = (name) => {
    if (/gong/i.test(name)) return { theirAngle: 'Conversation intelligence — records & analyzes calls for AE managers.', ourCounter: 'Slipstream owns the SE execution layer: grounded follow-ups, demo/POC & RFP prep — not just call summaries.' };
    if (/kafka|in.?house|build/i.test(name)) return { theirAngle: 'Build it in-house.', ourCounter: 'Months of eng time + ongoing maintenance vs. value in days, every claim grounded in the call.' };
    if (/clari/i.test(name)) return { theirAngle: 'Pipeline / forecasting for RevOps.', ourCounter: 'We act on the SE workflow, not just the dashboard — execution, not intelligence.' };
    return { theirAngle: 'Alternative under evaluation.', ourCounter: 'SE-native, grounded-by-evidence, fastest path from call to next step.' };
  };
  result.battlecards = [...seenCompetitors].map((name) => ({ competitor: name, ...angles(name), evidence: result.competitors.find((c) => c.name === name)?.evidence ?? null }));

  const turnsBy = new Map();
  for (const u of utterances) {
    if (!u.speaker) continue;
    const e = turnsBy.get(u.speaker) || { name: u.speaker, role: u.role || '', turns: 0 };
    e.turns++;
    if (!e.role && u.role) e.role = u.role;
    turnsBy.set(u.speaker, e);
  }
  const speakers = [...turnsBy.values()].sort((a, b) => b.turns - a.turns);
  const totalTurns = speakers.reduce((n, s) => n + s.turns, 0) || 1;
  const lead = speakers[0];
  result.analytics = {
    speakers,
    note: lead ? `${lead.name}${lead.role ? ` (${lead.role})` : ''} led ${lead.turns}/${totalTurns} turns; ${speakers.length} participants — multithread the rest of the buying committee.` : '',
  };

  return normalizeResult(result);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Collapse whitespace and clip to n chars — used everywhere we echo transcript text. */
function trimText(s, n = 120) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
}

function deriveRequirementText(category, text) {
  // Echo the prospect's own words — the most substantive sentence, so a question framing like
  // "How does it handle scale? We push 10M records/hour…" yields the real detail that follows.
  // The category carries the classification; we never fabricate specifics (SOC 2, Snowflake,
  // 50M…) that weren't actually said — that demo-overfit was the core finding of the CEO review.
  const sentences = String(text).split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean);
  const best = sentences.sort((a, b) => b.length - a.length)[0] || text;
  return trimText(best, 120);
}

function deriveActionTitle(text) {
  // Strip conversational filler + the leading commitment verb, then make it imperative.
  let t = text
    .trim()
    .replace(/^(absolutely|sure|great|okay|ok|understood|got it|perfect|honestly|thanks)\b[^.?!]*?[,.!]\s+/i, '')
    .replace(/^I'll\s+/i, '')
    .replace(/^Let me\s+/i, '')
    .replace(/^We'd need (it )?to\s+/i, '')
    .replace(/^We'd need\s+/i, 'Provide ')
    .replace(/^We need to\s+/i, '')
    .replace(/^Can we get\s+/i, 'Get ')
    .replace(/^Who should I\s+/i, 'Decide who to ')
    .trim();
  // First clause only, then capitalize.
  let s = t.split(/[.!?]/)[0].trim();
  s = s.charAt(0).toUpperCase() + s.slice(1);
  s = s.slice(0, 90).trim();
  return s || text.slice(0, 80);
}

function rfpQuestion(req) {
  // Echo the prospect's actual requirement as a confirm-question — never inject specifics
  // (SOC 2, Snowflake, 50M…) that a given call may not contain.
  const t = trimText(req.text, 110);
  switch (req.category) {
    case 'security':
      return `Security & compliance — can you meet: ${t}?`;
    case 'integration':
      return `Integration — do you support: ${t}?`;
    case 'scale':
      return `Scale & performance — can you handle: ${t}?`;
    default:
      return `Please confirm: ${t}`;
  }
}

function rfpAnswer(_req) {
  // The deterministic engine has NO knowledge of Slipstream's real capabilities, so it must
  // never assert one. Emit a neutral draft for the SE to confirm or mark as a gap. (A
  // "verified" answer is produced only when the transcript itself contains a confirmation —
  // see the rfpRows loop.)
  return '[Draft — confirm with product]: state how Slipstream meets this requirement, or flag it as a gap.';
}

/** Return true if two strings share at least one significant keyword */
function sharesKeywords(a, b) {
  const words = (s) =>
    s
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length > 4);
  const setA = new Set(words(a));
  return words(b).some((w) => setA.has(w));
}

function findEconomicBuyer(utterances) {
  for (const u of utterances) {
    // Prefer a name right after the CFO mention ("our CFO, Lena").
    let m = /\bCFO\b[,:]?\s+(?:is\s+|named\s+)?([A-Z][a-z]+)/.exec(u.text);
    if (m) return m[1];
    // Or a named budget owner ("Lena ... controls budget").
    m = /([A-Z][a-z]+)\b[^.]*\bcontrols?\s+(?:the\s+)?budget/.exec(u.text);
    if (m) return m[1];
    if (/\bCFO\b/.test(u.text)) return 'CFO';
  }
  return '';
}
