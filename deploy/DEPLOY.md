# Deploying Slipstream

## Status: staging is LIVE on hetzner1

Slipstream runs under **pm2** on hetzner1, bound to `127.0.0.1:3210`, serving the
deterministic (grounded) engine. It's `pm2 save`d, so it survives reboots, and it's
**path-prefix aware** (all API calls are relative) — it works at the domain root *or*
behind a sub-path.

```bash
pm2 status slipstream
curl -s http://127.0.0.1:3210/api/health    # {"status":"ok","llm":false,...}
```

## Go-live via studio.apit.fun/slipstream/  (recommended — no DNS, no cert)

Mounts Slipstream under the existing `studio.apit.fun` (already has DNS + TLS). One
vhost change, then reload. Needs your sudo:

```bash
cd ~/slipstream
sudo cp deploy/studio.apit.fun.conf /etc/nginx/sites-available/studio.apit.fun
sudo nginx -t && sudo systemctl reload nginx
curl -s https://studio.apit.fun/slipstream/api/health     # verify
```

→ Live at **https://studio.apit.fun/slipstream/**

`deploy/studio.apit.fun.conf` is the full current studio vhost with only a
`location /slipstream/` block added (proxies to `:3210`, strips the prefix). The
existing studio app at `/` is untouched. `nginx -t` will catch any typo before reload.

Verified locally by simulating the prefix-stripping proxy:
`/slipstream/api/health` → 200 JSON, `/slipstream/` → 200 HTML, `/slipstream/styles.css` → 200 CSS.

## Alternative: dedicated subdomain slipstream.apit.fun  (needs a DNS record)

If you'd rather have its own subdomain, use `deploy/slipstream.apit.fun.conf` and add a
`slipstream.apit.fun` DNS record (Cloudflare, like the other `*.apit.fun` apps), then
install that vhost + reload.

## Optional: enable the Claude path

The deterministic engine needs no key. To turn on Claude enrichment (Sonnet 4.6 default):

```bash
cd ~/slipstream
npm install @anthropic-ai/sdk
# set ANTHROPIC_API_KEY (+ optional SLIPSTREAM_MODEL) in ecosystem.config.cjs env
pm2 restart slipstream --update-env
```

## Re-deploy after code changes

```bash
cd ~/slipstream && git pull && pm2 restart slipstream
```
