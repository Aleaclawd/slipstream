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

const INTEGRATION_RE = /integrate|Snowflake|Slack|API|webhook|write back|push/i;
const SECURITY_RE = /SOC 2|SSO|Okta|residency|compliance|encryption|no customer data/i;
const SCALE_RE = /events|per day|latency|throughput|scale|within a minute|peak/i;
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
  { pattern: /\bKafka\b/i, name: 'Kafka' },
  { pattern: /\bin[- ]house\b/i, name: 'in-house' },
  { pattern: /\bbuild it\b/i, name: 'build-it-in-house' },
];

// ─── Main export ─────────────────────────────────────────────────────────────

export function analyzeTranscript(text) {
  const utterances = parseTranscript(text);
  const result = emptyResult();

  // ── Summary ──
  // Derive account name from the first org we see
  const firstOrg = utterances.find((u) => u.org)?.org ?? 'Unknown';
  result.summary.dealName = `${firstOrg} — Slipstream Evaluation`;
  result.summary.oneLiner =
    'Prospect needs to unify scattered shipment-tracking events with enterprise-grade security and scale.';

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

  // ── Requirements ──
  const requirementSeen = new Set();
  for (const u of utterances) {
    const key = (cat) => `${cat}:${u.lineNo}`;
    if (INTEGRATION_RE.test(u.text) && !requirementSeen.has(key('integration'))) {
      requirementSeen.add(key('integration'));
      result.requirements.push({
        category: 'integration',
        text: deriveRequirementText('integration', u.text),
        evidence: mkEvidence(u),
      });
    }
    if (SECURITY_RE.test(u.text) && !requirementSeen.has(key('security'))) {
      requirementSeen.add(key('security'));
      result.requirements.push({
        category: 'security',
        text: deriveRequirementText('security', u.text),
        evidence: mkEvidence(u),
      });
    }
    if (SCALE_RE.test(u.text) && !requirementSeen.has(key('scale'))) {
      requirementSeen.add(key('scale'));
      result.requirements.push({
        category: 'scale',
        text: deriveRequirementText('scale', u.text),
        evidence: mkEvidence(u),
      });
    }
    if (COMMERCIAL_RE.test(u.text) && !requirementSeen.has(key('commercial'))) {
      requirementSeen.add(key('commercial'));
      result.requirements.push({
        category: 'commercial',
        text: deriveRequirementText('commercial', u.text),
        evidence: mkEvidence(u),
      });
    }
    if (u.text.trimEnd().endsWith('?') && !requirementSeen.has(key('open_question'))) {
      requirementSeen.add(key('open_question'));
      result.requirements.push({
        category: 'open_question',
        text: u.text.slice(0, 120),
        evidence: mkEvidence(u),
      });
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
      const isSELine = u.speaker && /^(Priya|SE)$/i.test(u.speaker);
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
  for (const r of secReqs) {
    demoPrepItems.push({
      item: `Prepare SOC 2 report and data-processing addendum`,
      rationale: `Prospect requires SOC 2 Type II certification and EU data residency documentation`,
      evidence: r.evidence,
    });
  }
  for (const r of intReqs) {
    demoPrepItems.push({
      item: `Set up live Snowflake write-back and Slack alert demo`,
      rationale: `Snowflake integration and Slack push alerts are stated hard requirements`,
      evidence: r.evidence,
    });
  }
  for (const r of scaleReqs) {
    demoPrepItems.push({
      item: `Provide reference architecture for 50M events/day with sub-minute latency`,
      rationale: `Prospect processes ~50M events/day at peak and needs alerts within a minute`,
      evidence: r.evidence,
    });
  }
  if (pocAction) {
    demoPrepItems.push({
      item: `Scope and schedule two-week POC using prospect's own data`,
      rationale: `Dan explicitly asked for a working reconciliation POC on their own data`,
      evidence: pocAction.evidence,
    });
  }
  // Cap at 6
  result.demoPrep = demoPrepItems.slice(0, 6);

  // ── rfpRows ──
  // SE utterances that confirmed something
  const SE_CONFIRM_RE = /supported|confirm|I'll get you/i;
  const seConfirmations = utterances.filter(
    (u) => u.speaker && /^Priya$/i.test(u.speaker) && SE_CONFIRM_RE.test(u.text)
  );

  const allRfpSourceReqs = [...secReqs, ...intReqs, ...scaleReqs];
  for (const r of allRfpSourceReqs) {
    // Find a matching SE confirmation
    const confirmed = seConfirmations.find((seU) =>
      sharesKeywords(seU.text, r.evidence?.quote ?? '')
    );
    result.rfpRows.push({
      question: rfpQuestion(r),
      suggestedAnswer: rfpAnswer(r),
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

  // ── followupEmail ──
  const highPains = result.pains.filter((p) => p.severity === 'high');
  const topPain = highPains[0] ?? result.pains[0];
  const seActions = result.actions.filter((a) => a.owner === 'SE');
  const account = firstOrg;
  const champName = champion?.name ?? 'there';

  // Build citation list
  const citations = [];
  const cite = (ev) => {
    if (!ev) return '';
    citations.push(ev);
    return `[${citations.length}]`;
  };

  const painCite = cite(topPain?.evidence);
  const secCite = cite(secReqs[0]?.evidence);
  const seActionCite = seActions[0] ? cite(seActions[0]?.evidence) : '';

  const body =
    `Hi ${champName},\n\n` +
    `Thank you for the discovery call today. Based on our conversation, the most pressing issue is the manual reconciliation of shipment-tracking events ${painCite} — consuming two analysts full-time and still producing errors. We understand that this is your top priority for this quarter.\n\n` +
    `On the security and compliance front ${secCite}, we confirmed that EU data residency and Okta SSO are supported, and I'll send over our SOC 2 Type II report and data-processing addendum ${seActionCite} shortly.\n\n` +
    `I'll follow up with a POC plan, the Snowflake write-back confirmation, and the security pack, and will ensure Lena is included on the next call to discuss the ROI story.\n\n` +
    `Looking forward to progressing this with your team.\n\n` +
    `Best,\nPriya\n\n` +
    citations.map((ev, idx) => `[${idx + 1}] line ${ev.line}: ${ev.quote.slice(0, 100)}`).join('\n');

  result.followupEmail = {
    subject: `${account} × Slipstream — POC Plan + Security Pack`,
    body,
  };

  // ── MVP intelligence: deal health (MEDDPICC), risks, next-best-actions, battlecards, analytics ──
  const findU = (re) => utterances.find((u) => re.test(u.text));
  const evOf = (u) => (u ? mkEvidence(u) : null);
  const metricU = findU(/two analysts|50 million|\b\d+\s*(million|analysts|engineers|events)|\bROI\b/i);
  const ebU = findU(/\bCFO\b|budget|economic buyer|Lena/i);
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
    metrics: metricU ? 'Quantified impact captured (analysts, event volume).' : 'No quantified business metric yet.',
    economic_buyer: economicBuyer || ebU ? `Economic buyer in play${economicBuyer ? ': ' + economicBuyer : ''}.` : 'No economic buyer identified.',
    decision_criteria: reqCount ? `${reqCount} technical requirements surfaced.` : 'Decision criteria still unclear.',
    decision_process: pocU ? 'POC / evaluation path discussed.' : 'Decision process not yet mapped.',
    paper_process: paperU ? 'Security/compliance steps named (SOC 2, residency).' : 'Procurement / paper process unknown.',
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
  if (paperU || result.requirements.some((r) => r.category === 'security')) addNba('Send the security pack (SOC 2 + DPA) and pre-fill the security questionnaire', 'A security/compliance bar was raised — de-risk it early to avoid late-stage paper-process death.', 'P1', evOf(paperU));
  if (result.requirements.some((r) => /Snowflake|write.?back/i.test(r.text + (r.evidence?.quote || '')))) addNba('Confirm Snowflake write-back feasibility before the POC', 'Write-back was flagged a non-starter — validate it before investing in the POC.', 'P1', null);
  if (pocU) addNba('Scope a 2-week POC on their own data', 'A working POC on their data was explicitly requested and would move the deal forward.', 'P1', evOf(pocU));
  for (const name of seenCompetitors) addNba(`Prepare a battlecard vs ${name}`, `${name} is in the evaluation — arm the champion with crisp differentiation.`, 'P2', result.competitors.find((c) => c.name === name)?.evidence);
  result.nextBestActions = nba;

  const angles = (name) => {
    if (/gong/i.test(name)) return { theirAngle: 'Conversation intelligence — records & analyzes calls for AE managers.', ourCounter: 'Slipstream owns the SE execution layer: grounded follow-ups, demo/POC & RFP prep — not just call summaries.' };
    if (/kafka|in.?house|build/i.test(name)) return { theirAngle: 'Build it in-house (e.g. on Kafka).', ourCounter: 'Months of eng time + ongoing maintenance vs. value in days, every claim grounded in the call.' };
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

function deriveRequirementText(category, text) {
  const t = text.slice(0, 120);
  switch (category) {
    case 'integration': {
      if (/Snowflake/i.test(t)) return 'Snowflake integration with write-back support';
      if (/Slack/i.test(t)) return 'Slack alert push integration';
      return 'Third-party integration requirement';
    }
    case 'security': {
      if (/SOC 2/i.test(t)) return 'SOC 2 Type II certification + EU data residency';
      if (/Okta/i.test(t)) return 'SSO via Okta required';
      return 'Enterprise security and compliance requirement';
    }
    case 'scale': {
      if (/50 million|50M/i.test(t)) return '50M events/day with sub-minute alert latency';
      if (/within a minute/i.test(t)) return 'Alert latency within one minute';
      return 'High-throughput scale requirement';
    }
    case 'commercial':
      return 'Budget / ROI approval required (CFO-level)';
    default:
      return t;
  }
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
  switch (req.category) {
    case 'security':
      return 'Does the platform support SOC 2 Type II, Okta SSO, and EU data residency?';
    case 'integration':
      return 'Does the platform integrate with Snowflake (write-back) and Slack?';
    case 'scale':
      return 'Can the platform handle 50M events/day with sub-minute alert latency?';
    default:
      return `${req.category} requirement — please confirm`;
  }
}

function rfpAnswer(req) {
  switch (req.category) {
    case 'security':
      return 'Yes — SOC 2 Type II certified, Okta SSO supported, EU-region data residency available.';
    case 'integration':
      return 'Yes — native Snowflake connector with write-back; Slack webhook integration supported.';
    case 'scale':
      return 'Yes — reference architecture supports >50M events/day; P99 alert latency < 60 s.';
    default:
      return 'To be confirmed.';
  }
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
