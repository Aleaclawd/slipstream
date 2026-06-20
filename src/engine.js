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

  // Pattern 1: "Name (Role, Org): text", with an OPTIONAL leading timestamp in any of
  // the [MM:SS] / [H:MM:SS] / [HH:MM:SS] forms that Otter/Zoom/Fireflies/Gong/Fathom emit.
  // The timestamp is optional so the default no-timestamp export shape still parses (was a
  // total-failure case: zero stakeholders, all speaker=null).
  const FULL_RE = /^(?:\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*)?([^([\]]+?)\s+\(([^,)]+),\s*([^)]+)\):\s*(.*)$/;
  // Pattern 2: "Speaker: text" — allow "Speaker 1:", lowercase names ('dan:'), and a
  // leading timestamp, which ASR/meeting tools commonly emit.
  const SIMPLE_RE = /^(?:\[(\d{1,2}:\d{2}(?::\d{2})?)\]\s*)?([A-Za-z][A-Za-z0-9\s'._-]{0,39}?):\s+(.+)$/;
  // Lines like "Action Items:", "Next Steps:", "Summary:" are section headers in pasted
  // notes, not dialogue — don't let SIMPLE_RE turn them into phantom speakers.
  const SECTION_HEADER = /^(action items?|next steps?|meeting notes?|notes?|agenda|attendees?|summary|recap|todo|to-?do|follow[- ]?ups?|key takeaways?|decisions?|risks?)$/i;

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1; // 1-based
    const raw = lines[i];
    const trimmed = raw.trim();

    let m;
    if ((m = FULL_RE.exec(trimmed))) {
      utterances.push({
        lineNo,
        ts: m[1] ?? null,
        speaker: m[2].trim(),
        role: m[3].trim(),
        org: m[4].trim(),
        text: m[5].trim(),
        raw: trimmed,
      });
    } else if ((m = SIMPLE_RE.exec(trimmed)) && !SECTION_HEADER.test(m[2].trim())) {
      utterances.push({
        lineNo,
        ts: m[1] ?? null,
        speaker: m[2].trim(),
        role: null,
        org: null,
        text: m[3].trim(),
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
const SCALE_RE = /per day|per hour|per second|per minute|latency|throughput|\bscale\b|within (?:a|one|\d|a few) minutes?|\bpeak\b|\bspikes?\b|\b\d[\d,.]*\s*[kmb]?\s*(?:events|records|rows|requests|messages|transactions|qps|rps|tps|users|calls)\b|\b\d[\d,.]*\s*[kmb]\b\s*(?:\/|per\b)|\b(?:million|thousand|billion)\s+(?:events|records|rows|requests|messages|transactions)/i;
const COMMERCIAL_RE = /budget|ROI|CFO|pricing|cost/i;

const OBJECTION_RE = /concern|worried|whether a startup|burned|non-starter|risk/i;

const ACTION_RE = /I'll|let me|we'd need|need to|can we get|send|confirm|line up|add/i;
const SE_ACTION_RE = /^(I'll|let me)/i;
// A real commitment/ask, not just a pain that happens to contain "need to".
const COMMIT_RE = /I'll|let me|can we get|we'd need|send|confirm|line up|please|let's|\badd\b/i;
const P1_RE = /POC|non-starter|security pack|this quarter/i;
// Relative + absolute due-dates. The prior version matched only a 5-phrase whitelist, so most
// real commitments entered the queue with no date (S3/S8/S14): 'three weeks', 'in a month',
// 'within 30 days', 'by Friday', 'next Tuesday', 'end of Q3' all yielded no due. We capture the
// phrase (the parser has no call-date to resolve against).
const TIMEFRAME_RE = /\b(?:in|within|by|next|this|over|after)\s+(?:a\s+|an\s+|one\s+|two\s+|three\s+|four\s+|five\s+|six\s+|few\s+|couple\s+(?:of\s+)?|\d+\s+)?(?:day|week|month|quarter|business\s+day)s?\b|\b(?:a\s+|one\s+|two\s+|three\s+|four\s+|few\s+|\d+\s+)(?:day|week|month|quarter)s?\b|\bby\s+(?:end\s+of\s+)?(?:Q[1-4]|EO[DW]|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\bnext\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|\bend\s+of\s+(?:Q[1-4]|(?:the\s+)?(?:week|month|quarter|day))\b|\bby\s+\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/i;

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
  // SE role detection. S18 fix: the prior regex put a trailing \b right after "eng"/"exec",
  // which mid-word-blocked the product's OWN canonical titles — "Sales Engineer" and
  // "Account Executive" both returned false, breaking SE/prospect attribution downstream.
  const SE_ROLE_RE = /\b(?:SE|AE)\b|sales\s+eng(?:ineer)?|solutions?\s+(?:consultant|engineer|architect)|account\s+exec(?:utive)?/i;
  const seUtterance = utterances.find((u) => SE_ROLE_RE.test(u.role || ''));
  const seByRole = seUtterance?.speaker || '';
  const seOrg = seUtterance?.org || null;
  const seSpeaker = seByRole || utterances.find((u) => u.speaker)?.speaker || '';
  // Normalize org names so trivial spelling variants of the same vendor ("Acme" / "Acme Inc" /
  // "Acme, Inc.") compare equal (verify-skeptic refutation).
  const normOrg = (o) =>
    String(o || '').toLowerCase().replace(/[.,]/g, ' ')
      .replace(/\b(?:inc|llc|corp|co|ltd|company|gmbh|plc)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const seOrgNorm = normOrg(seOrg);
  // SE-SIDE = anyone selling: a recognized SE/AE role, OR the same (normalized) seller org, OR
  // the resolved SE name. So a second seller rep (an AE alongside the SE) is also SE-side — their
  // actions are owned 'SE' and their lines aren't mined as prospect requirements (S29 + multi-rep).
  // A prospect sharing the SE's first name is excluded by the org check.
  const isSE = (u) => Boolean(
    SE_ROLE_RE.test(u.role || '') ||
    (seOrgNorm && u.org && normOrg(u.org) === seOrgNorm) ||
    (seSpeaker && u.speaker === seSpeaker && (seOrg == null || u.org == null || normOrg(u.org) === seOrgNorm))
  );
  // Account = the PROSPECT org: first org from a speaker who isn't the SE (the SE's own org
  // would otherwise win just by speaking first). Fall back to any org, then "Unknown".
  // Account = the PROSPECT org. Exclude the SELLER ORG (not just the single SE name) so a
  // multi-rep selling team (SE + AE from the same vendor org) can't flip the Account to the
  // seller's own org (verify-skeptic refutation). Fall back to name-exclusion when the SE has
  // no role/org tag, then to any org.
  const firstOrg =
    utterances.find((u) => u.org && (seOrgNorm ? normOrg(u.org) !== seOrgNorm : u.speaker && u.speaker !== seSpeaker))?.org ||
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
    // handled separately, as RFP verification). S24: skip by resolved SE identity, not only
    // when a role tag matched — otherwise a role-less SE's own pitch lines become "requirements".
    if (isSE(u)) continue;
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
      // Owner by SPEAKER identity, not by the text starting with "I'll" — a PROSPECT who says
      // "I'll send you our data dictionary" must be owned as Prospect, not SE (S6/S13). The
      // leading-verb heuristic is only a fallback for genuinely speaker-less lines.
      const owner = isSE(u)
        ? 'SE'
        : (u.speaker ? 'Prospect' : (SE_ACTION_RE.test(u.text) ? 'SE' : 'Prospect'));
      const priority = P1_RE.test(u.text) ? 'P1' : 'P2';
      const tm = TIMEFRAME_RE.exec(u.text);
      const due = tm ? tm[0] : '';
      // Split a multi-deliverable utterance into distinct actions so the queue captures all of
      // them, not just the first clause (S4/S20). e.g. "Let me line up a POC, confirm the
      // write-back, and send the security pack" -> 3 actions.
      for (const title of deriveActionTitles(u.text)) {
        result.actions.push({ title, owner, due, priority, evidence: mkEvidence(u) });
      }
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
  // A genuine confirmation is an SE statement that a capability PRESENTLY EXISTS — never a
  // future promise ("I'll confirm…", "let me…"), a negation ("not supported"), or a question.
  // We evaluate at the CLAUSE level so a line like "EU residency and Okta SSO are supported.
  // I'll get you the report." yields the confirmation from the first clause without the promise
  // in the second laundering anything (S1/S5). Each confirmation is tagged with the requirement
  // category it actually speaks to, so an SSO confirmation can't verify a scale row (S22).
  // Affirmative present-tense capability. Recognizes the predicate adjectives AND the common
  // category-defining capability VERBS ("we integrate with Snowflake", "it writes back") — the
  // prior version keyed only on supported/compliant/certified and silently failed every
  // action-verb confirmation (verify-skeptic refutation). Future/conditional/negated forms are
  // still excluded downstream by FUTURE_PROMISE_RE / NEGATION_RE / RETRACT_RE / contested.
  // NOTE: this is a finite predicate set — novel affirmative phrasings are the documented
  // deterministic ceiling, deferred to the LLM-judge pass.
  const AFFIRM_RE = /\bsupported\b|\bcompliant\b|\bcertified\b|\bnatively\b|\b(?:is|are|both|fully|already)\s+(?:supported|available|compliant|certified|in\s+place)\b|\b(?:we|it|that|this)\s+(?:support|integrate|connect|sync|handle|scale|push|write|provide|offer|meet|run|cover|enable|deliver|do|have|can|already)s?\b/i;
  const FUTURE_PROMISE_RE = /\b(?:i'?ll|we'?ll|i\s+will|we\s+will|let\s+me|going\s+to)\b/i;
  const NEGATION_RE = /\b(?:not|cannot|can'?t|don'?t|won'?t|isn'?t|aren'?t|doesn'?t|never|unable)\b/i;
  // A capability the SE marks as NOT presently available: explicit unavailability, a
  // future/conditional ("once the contract…"), or roadmap/beta. Disqualifies a clause AND
  // marks the category "contested" so a retraction in an ADJACENT sentence or a LATER SE
  // utterance — which the per-clause checks miss — still blocks 'verified' (verify-skeptic
  // refutation: negation-laundering across sentences/utterances).
  const RETRACT_RE = /\bnot\s+(?:available|supported|yet|certified|live|ready|GA|generally\s+available|in\s+place)\b|\bnot\s+yet\b|\bno\s+\w+(?:\s+\w+){0,3}?\s+(?:yet|today)\b|\bon\s+(?:our|the)\s+(?:roadmap|backlog)\b|\bcoming\s+soon\b|\bin\s+(?:beta|preview|early\s+access)\b|\bearly\s+access\b|\bpending\b|\b(?:next|upcoming|future)\s+release\b|\b(?:planned|slated|targeting|targeted)\b|\bin\s+the\s+pipeline\b|\blimited\s+availability\b|\bonce\s+(?:the\s+)?(?:contract|deal|paperwork|you|we)\b|\bafter\s+(?:the\s+)?(?:contract|signing)\b|\bnot\s+today\b/i;
  const catOf = (t) =>
    SECURITY_RE.test(t) ? 'security' : INTEGRATION_RE.test(t) ? 'integration' : SCALE_RE.test(t) ? 'scale' : null;

  const seConfirmClauses = [];
  const contestedCategories = new Set();
  for (const u of utterances) {
    if (!isSE(u)) continue;
    // If the SE negates/hedges a category ANYWHERE in this utterance, that category can't be
    // 'verified' from this call — catches a retraction in an adjacent sentence the per-clause
    // checks would miss ("…are supported. They are not available today.").
    if (NEGATION_RE.test(u.text) || RETRACT_RE.test(u.text)) {
      const c = catOf(u.text);
      if (c) contestedCategories.add(c);
    }
    for (const sentence of String(u.text).split(/(?<=[.?!])\s+/)) {
      const s = sentence.trim();
      if (!s || s.endsWith('?')) continue; // questions aren't confirmations
      if (!AFFIRM_RE.test(s) || FUTURE_PROMISE_RE.test(s) || NEGATION_RE.test(s) || RETRACT_RE.test(s)) continue;
      const category = catOf(s);
      if (category) seConfirmClauses.push({ text: s, category, u });
    }
  }

  const allRfpSourceReqs = [...secReqs, ...intReqs, ...scaleReqs];
  for (const r of allRfpSourceReqs) {
    // 'verified' ONLY by a SAME-category affirmative confirmation that also shares a keyword,
    // AND only if the SE never contested that category. Deferred/negated/conditional
    // capabilities stay 'unverified' (the SE's "I'll confirm…" promise is captured as an action).
    const confirmed = !contestedCategories.has(r.category) && seConfirmClauses.find(
      (c) => c.category === r.category && sharesKeywords(c.text, r.text)
    );
    result.rfpRows.push({
      question: rfpQuestion(r),
      suggestedAnswer: confirmed ? `Confirmed on the call: "${trimText(confirmed.text, 100)}"` : rfpAnswer(r),
      status: confirmed ? 'verified' : 'unverified',
      evidence: confirmed ? mkEvidence(confirmed.u) : r.evidence,
    });
  }

  // ── crmFields ──
  const champion = result.stakeholders.find((s) =>
    /VP|Director|Head|Lead|Data Eng/i.test(s.role)
  ) ?? result.stakeholders[0];
  const ebFound = findEconomicBuyer(utterances);
  const economicBuyer = ebFound.name;
  // NextStep is the SELLER's next step — prefer an SE-owned P1, not just the first P1 in
  // transcript order, which can be a PROSPECT's conditional ("If you can show us… ") (S25).
  const topP1 =
    result.actions.find((a) => a.owner === 'SE' && a.priority === 'P1') ||
    result.actions.find((a) => a.owner === 'SE') ||
    result.actions.find((a) => a.priority === 'P1');

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
    // Cite the line that actually established the economic buyer, matching dimNotes (S26).
    economic_buyer: ebFound.evidence ?? evOf(ebU),
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

// Split an SE commitment utterance into its DISTINCT deliverables so a multi-commitment line
// becomes multiple queue items (S4/S20). Only the comma-list of a leading-commitment sentence
// ("Let me A, B, and C") is split; a non-commitment sentence stays whole. A clause counts only
// if it carries a commitment verb — so a confirmation sentence ("…are supported.") is dropped and
// the real deliverable in a later sentence ("I'll get you the report") becomes the action.
function deriveActionTitles(text) {
  const stripped = String(text).trim()
    .replace(/^(absolutely|sure|great|okay|ok|understood|got it|perfect|honestly|thanks)\b[^.?!]*?[,.!]\s+/i, '');
  const COMMIT_VERB = /\b(?:send|confirm|line\s+up|get\s+you|prepare|schedule|share|provide|follow\s+up|set\s+up|build|scope|draft|pull\s+together|put\s+together|loop\s+in|bring|review|sync|deliver|write\s+up)\b/i;
  const clauses = [];
  for (const sent of stripped.split(/(?<=[.?!])\s+/)) {
    const lead = sent.match(/^\s*(?:I'?ll|Let me|We'?ll|We will|I will|I can|We can)\s+(.*)$/i);
    const parts = lead ? lead[1].split(/,\s+(?:and\s+)?/i) : [sent];
    for (const p of parts) clauses.push(p.trim());
  }
  const actionClauses = clauses.filter((c) => c && COMMIT_VERB.test(c));
  const titles = [];
  for (const c of actionClauses.length ? actionClauses : [stripped]) {
    const t = deriveActionTitle(c);
    if (t && !titles.includes(t)) titles.push(t);
  }
  return titles.length ? titles : [deriveActionTitle(text)];
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
  // Significant shared keyword — NOT a length threshold. Enterprise asks ARE short acronyms
  // (SSO=3, SOC=3, API=3, Okta=4, SAML=4); the old `length > 4` filter silently failed to verify
  // a legitimate, identical-keyword "Okta SSO is supported" confirmation (verify-skeptic
  // refutation — the engine's primary value path). Filter common words via a stoplist instead,
  // and strip trivial plurals so webhook/webhooks match.
  const STOP = new Set([
    'the', 'and', 'with', 'need', 'would', 'that', 'this', 'your', 'our', 'their', 'from', 'have',
    'will', 'about', 'into', 'what', 'when', 'where', 'which', 'there', 'they', 'them', 'then', 'than',
    'also', 'some', 'more', 'most', 'very', 'just', 'like', 'make', 'made', 'does', 'done', 'both',
    'each', 'only', 'over', 'must', 'able', 'want', 'take', 'give', 'data', 'call', 'team', 'time',
    'plan', 'help', 'sure', 'okay', 'good', 'great', 'thanks', 'yes', 'are', 'was', 'were', 'has',
    'its', 'for', 'but', 'not', 'all', 'any', 'get', 'can', 'you', 'use', 'via', 'per', 'out', 'now',
    'one', 'two', 'too', 'let', 'see', 'say', 'set', 'run', 'day', 'is',
  ]);
  const stem = (w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w);
  const keys = (s) =>
    new Set((String(s).toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => w.length >= 2 && !STOP.has(w)).map(stem));
  const setA = keys(a);
  for (const w of keys(b)) if (setA.has(w)) return true;
  return false;
}

function findEconomicBuyer(utterances) {
  // Returns { name, evidence } so the MEDDPICC economic_buyer note and its cited line come
  // from the SAME utterance (S26 — they used to be derived from independent searches and could
  // cite a line that didn't establish the buyer).
  for (const u of utterances) {
    // Prefer a name right after the CFO mention ("our CFO, Lena").
    let m = /\bCFO\b[,:]?\s+(?:is\s+|named\s+)?([A-Z][a-z]+)/.exec(u.text);
    if (m) return { name: m[1], evidence: mkEvidence(u) };
    // Or a named budget owner ("Lena ... controls budget").
    m = /([A-Z][a-z]+)\b[^.]*\bcontrols?\s+(?:the\s+)?budget/.exec(u.text);
    if (m) return { name: m[1], evidence: mkEvidence(u) };
    if (/\bCFO\b/.test(u.text)) return { name: 'CFO', evidence: mkEvidence(u) };
  }
  return { name: '', evidence: null };
}
