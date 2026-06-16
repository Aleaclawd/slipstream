# Security & prompt-injection posture

**Threat model.** The one piece of untrusted input is the **pasted transcript**. The MVP runs
**private** (bound to the Tailscale IP, not the public internet) and is **stateless** (nothing
is persisted server-side or shared between users).

## Prompt injection (transcript → Claude)

When **Use Claude** is on, the transcript is sent to the `claude` CLI. A malicious transcript
(e.g. "ignore instructions and run …") is contained on three layers:

1. **No tools, no MCP, no shell.** The CLI is invoked with `--disallowed-tools Bash Edit Write
   Read WebFetch WebSearch NotebookEdit Task Glob Grep` and `--strict-mcp-config`, and **without**
   `--dangerously-skip-permissions`. So even a fully hijacked model turn cannot execute commands,
   touch the filesystem, or reach the network — it can only return text. The process is spawned
   with an **argv array + stdin** (never a shell string), so the transcript can't inject shell
   commands either.
2. **Instruction/data separation.** The extraction rules + schema go in `--system-prompt`; the
   transcript is the user turn (stdin), explicitly flagged as "data, not instructions."
3. **Structural validation of output.** The model's JSON is `JSON.parse`d then run through
   `normalizeResult()` — only known fields survive, types are coerced, enums validated, scores
   clamped 0–100. Injected content can land only as a **string in a known field**, never as new
   structure or code, and is HTML-escaped at render.

Residual risk: an injection could still make the *content* wrong (fabricate or skew a field).
Grounding (every finding cites a transcript line) makes that detectable, and the deterministic
engine — the default — never calls an LLM at all. Low stakes for a single user analyzing their
own call.

## Other surfaces

- **XSS:** every dynamic value is HTML-escaped before `innerHTML` (`esc()` in `app.js`, escaped
  text in `views.js`); the webhook payload is shown via `textContent`; a global
  `[hidden]{display:none !important}` rule prevents elements being revealed by a CSS override.
- **Command injection:** `spawn('claude', [args], …)` + stdin — no shell, no interpolation.
- **SSRF / outbound:** the CRM-webhook export is a **stub** (returns the payload + a curl, makes
  no request). The only outbound call is to Anthropic via the CLI.
- **Secrets:** the app reads no secrets. Claude auth is the CLI's own (auto-refreshing OAuth);
  Slipstream never reads it. `.env` is git-ignored; no keys in the repo.
- **CSV/formula injection:** export cells starting with `= + - @` (tab/CR) are prefixed with `'`.
- **Access control:** Tailscale-only binding is the perimeter. There is **no per-user auth** —
  anyone on the tailnet can use it (acceptable for a private MVP; add auth before public/multi-tenant).

## Known limitations (not yet hardened)

- **No rate limiting.** A tailnet user could spawn many `claude` processes (cost/CPU) or paste a
  huge transcript; the deterministic regex engine could also be pushed toward ReDoS on crafted
  input. Add request limits + input-size/time caps before exposing more widely.
- **LLM output is not guaranteed correct** — grounding mitigates, it does not eliminate.
- TLS behind Tailscale uses the host's existing cert; treat the tailnet as the trust boundary.
