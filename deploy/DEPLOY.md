# Deploying Slipstream

## Status: staging is LIVE on hetzner1

Slipstream is already running under **pm2** on hetzner1, bound to `127.0.0.1:3210`,
serving the deterministic (grounded) engine. It's `pm2 save`d, so it survives reboots.

```bash
pm2 status slipstream          # → online, id 7
curl -s http://127.0.0.1:3210/api/health    # {"status":"ok","llm":false,...}
```

What's **not** done (needs your sudo — the privileged cutover):

## Public cutover (owner, ~2 min)

1. **DNS** — add `slipstream.apit.fun` the same way as the other `*.apit.fun` apps
   (Cloudflare record pointing at this host).
2. **Install the vhost:**
   ```bash
   sudo cp deploy/slipstream.apit.fun.conf /etc/nginx/sites-available/slipstream.apit.fun
   sudo ln -s ../sites-available/slipstream.apit.fun /etc/nginx/sites-enabled/slipstream.apit.fun
   sudo nginx -t && sudo systemctl reload nginx
   ```
3. **Verify:**
   ```bash
   curl -I https://slipstream.apit.fun/api/health
   ```

The vhost mirrors `studio.apit.fun` (same listen address + `porsche-game.crt`). Swap to
the wildcard `*.apit.fun` Let's Encrypt cert if you'd rather.

## Optional: enable the Claude path

The deterministic engine needs no key. To turn on Claude enrichment (Sonnet 4.6 default):

```bash
cd ~/slipstream
npm install @anthropic-ai/sdk
# set ANTHROPIC_API_KEY (and optional SLIPSTREAM_MODEL) in ecosystem.config.cjs env
pm2 restart slipstream --update-env
```

## Re-deploy after code changes

```bash
cd ~/slipstream && git pull && pm2 restart slipstream
```
