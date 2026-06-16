# Deploying Slipstream

## Status: staging is LIVE on hetzner1

Slipstream runs under **pm2** on hetzner1, bound to `127.0.0.1:3210`, serving the
deterministic (grounded) engine. `pm2 save`d (survives reboots), and path-prefix aware
(all API calls relative) — works at a domain root or behind a sub-path.

```bash
pm2 status slipstream
curl -s http://127.0.0.1:3210/api/health    # {"status":"ok","llm":false,...}
```

## Go-live at studio.911fund.io  (primary)

`studio.911fund.io` is a **new** subdomain (not yet configured), so two owner steps:

**1. Cloudflare DNS** — add `studio.911fund.io` (proxied, like `turbo`/`skills.911fund.io`)
pointing at this host. Cloudflare Universal SSL covers `*.911fund.io`, so public TLS is
automatic; the origin uses the shared `porsche-game.crt` (Full mode).

**2. nginx vhost** (needs sudo):
```bash
cd ~/slipstream
sudo cp deploy/studio.911fund.io.conf /etc/nginx/sites-available/studio.911fund.io
sudo ln -s ../sites-available/studio.911fund.io /etc/nginx/sites-enabled/studio.911fund.io
sudo nginx -t && sudo systemctl reload nginx
curl -sk https://studio.911fund.io/api/health
```

→ Live at **https://studio.911fund.io/** (Slipstream at the root).

Want it under a path instead (`studio.911fund.io/slipstream/`)? Change the vhost
`location /` to `location /slipstream/` with `proxy_pass http://127.0.0.1:3210/;` (trailing
slash) — the app already handles the prefix (verified via a simulated proxy).

> **Standalone — does not touch the studio.** Slipstream gets its own subdomain, its own
> nginx vhost, and its own pm2 process (`:3210`). It is **not** mounted on, and does not
> modify, `studio.apit.fun` (the Paperclip studio) or any existing service.

## Alternative subdomain

- `deploy/slipstream.apit.fun.conf` — same standalone setup on `slipstream.apit.fun` instead.

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
