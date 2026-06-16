// Optional Claude-powered enrichment.
//
// Slipstream's core engine (engine.js) is deterministic and always runs with
// zero dependencies and no network. This module is a *quality upgrade*: when
// the official Anthropic SDK is installed AND an ANTHROPIC_API_KEY is present,
// we ask Claude to perform the same grounded extraction with better language
// understanding — still returning the identical evidence-carrying contract.
//
// Model choice is a deliberate product/unit-economics decision: Slipstream
// processes many transcripts per seat, so we default to Claude Sonnet 4.6
// ($3/$15 per MTok) for quality with strong structured-output support, and
// expose Haiku 4.5 ($1/$5) as the budget tier. Override with SLIPSTREAM_MODEL
// (e.g. SLIPSTREAM_MODEL=claude-opus-4-8 for the premium tier).

import { EXTRACTION_JSON_SCHEMA, normalizeResult } from './schema.js';

export const DEFAULT_MODEL = process.env.SLIPSTREAM_MODEL || 'claude-sonnet-4-6';

const SYSTEM = `You are Slipstream, an extraction engine for technical sellers (sales engineers / solutions consultants).
You are given a raw sales-call transcript. Produce a grounded action queue.

HARD RULES:
- Ground EVERY finding in the transcript. For each item, set "evidence" to the exact span it came from:
  { "quote": "<verbatim text>", "line": <1-based line number in the transcript>, "speaker": <name or null>, "ts": <timestamp token or null> }.
- If you cannot point to a specific line, set "evidence": null and (for rfpRows) "status": "unverified".
- NEVER assert a technical capability, security posture, or commitment that is not present in the transcript. A confident wrong answer is worse than no answer.
- The follow-up email must only restate things grounded in the transcript; use inline [1],[2] citation markers.
Return ONLY the JSON object matching the provided schema.`;

/** Raised when enrichment can't run; the server falls back to the deterministic engine. */
export class LlmUnavailable extends Error {}

export function llmConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Run grounded extraction through Claude. Resolves to a normalized
 * ExtractionResult, or throws LlmUnavailable if the SDK/key is missing.
 * @param {string} transcript
 * @returns {Promise<{result: object, model: string}>}
 */
export async function analyzeWithClaude(transcript) {
  if (!llmConfigured()) {
    throw new LlmUnavailable('ANTHROPIC_API_KEY not set');
  }
  let Anthropic;
  try {
    ({ default: Anthropic } = await import('@anthropic-ai/sdk'));
  } catch {
    throw new LlmUnavailable('@anthropic-ai/sdk not installed (run: npm i @anthropic-ai/sdk)');
  }

  const client = new Anthropic();
  const model = DEFAULT_MODEL;

  // Number the transcript lines so the model's "line" references are reliable.
  const numbered = transcript
    .split('\n')
    .map((l, i) => `${i + 1}: ${l}`)
    .join('\n');

  const resp = await client.messages.create({
    model,
    max_tokens: 8000,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Transcript (each line is prefixed with its 1-based line number):\n\n${numbered}`,
      },
    ],
    output_config: { format: { type: 'json_schema', schema: EXTRACTION_JSON_SCHEMA } },
  });

  if (resp.stop_reason === 'refusal') {
    throw new LlmUnavailable('model declined the request');
  }
  const text = resp.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new LlmUnavailable('empty model response');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LlmUnavailable('model did not return valid JSON');
  }
  return { result: normalizeResult(parsed), model };
}
