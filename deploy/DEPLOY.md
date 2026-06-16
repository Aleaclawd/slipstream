# Deploying Slipstream (private / Tailscale-only)

## Status: live PRIVATELY on hetzner1

Slipstream runs under **pm2**, bound to the **Tailscale IP `100.124.131.86:3210`** — it is
**not** on the public interface (a request to `127.0.0.1:3210` or the public IP is refused).
Deterministic (grounded) engine; `pm2 save`d.

Reachable **right now from any device on the tailnet** (Slipstream at the root, no nginx needed):

```
http://100.124.131.86:3210/
```

```bash
pm2 status slipstream
curl -s http://100.124.131.86:3210/api/health    # {"status":"ok","llm":false,...}
```

## Private go-live at studio.911fund.io/slipstream/  (Tailscale-only)

The vhost (`deploy/studio.911fund.io.conf`) binds the Tailscale IP only — mirroring
`studio.apit.fun` / `jose.911fund.io`. Two owner steps:

**1. Make `studio.911fund.io` resolve to the Tailscale IP for tailnet devices.** Pick one:
- **Cloudflare DNS-only (grey-cloud) A record** `studio.911fund.io → 100.124.131.86` — simplest.
  It resolves everywhere, but `100.124.131.86` is a Tailscale CGNAT address, so it's only
  *reachable* from the tailnet. (Must be DNS-only / unproxied — Cloudflare can't proxy a
  private IP.)
- **Tailscale MagicDNS** split-DNS / a custom record, or
- per-device `/etc/hosts`: `100.124.131.86  studio.911fund.io`.

**2. Install the vhost (needs sudo):**
```bash
cd ~/slipstream
sudo cp deploy/studio.911fund.io.conf /etc/nginx/sites-available/studio.911fund.io
sudo ln -s ../sites-available/studio.911fund.io /etc/nginx/sites-enabled/studio.911fund.io
sudo nginx -t && sudo systemctl reload nginx
# from a tailnet device:
curl -k https://studio.911fund.io/slipstream/api/health
```

→ Private at **https://studio.911fund.io/slipstream/** (bare domain redirects there). TLS is
the self-signed `porsche-game.crt`, so browsers warn — expected for a private service (or use
`http://`). Path serving verified via a simulated prefix-stripping proxy.

## Going public later

When you want it public: in `deploy/studio.911fund.io.conf` change the `listen 100.124.131.86:...`
lines to public (`listen 443 ssl; listen [::]:443 ssl;`), switch the Cloudflare record to
**proxied** (orange cloud → Universal SSL handles public TLS), and set the pm2 app back to a
normal bind (`HOST=127.0.0.1` in `ecosystem.config.cjs`, with the vhost proxying `127.0.0.1:3210`),
then `pm2 restart slipstream --update-env` + reload nginx.

## Optional: enable the Claude path

The deterministic engine needs no key. To turn on Claude enrichment (Sonnet 4.6 default):
```bash
cd ~/slipstream && npm install @anthropic-ai/sdk
# set ANTHROPIC_API_KEY (+ optional SLIPSTREAM_MODEL) in ecosystem.config.cjs env
pm2 restart slipstream --update-env
```

## Re-deploy after code changes

```bash
cd ~/slipstream && git pull && pm2 restart slipstream
```
