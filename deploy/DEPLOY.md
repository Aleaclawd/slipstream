# Deploying Slipstream (private / Tailscale-only)

## Status: live PRIVATELY on hetzner1

Slipstream runs under **pm2**, bound to the **Tailscale IP `100.124.131.86:3210`** — not on
the public interface (`127.0.0.1:3210` and the public IP are refused). Deterministic
(grounded) engine; `pm2 save`d.

Reachable **right now from any tailnet device** (Slipstream at the root, no nginx needed):

```
http://100.124.131.86:3210/
```

## Go-live at studio.apit.fun/slipstream/  (private, DNS-free)

`studio.apit.fun` already exists and its HTTPS is bound to the Tailscale IP only (its content
isn't served on the public interface). Mounting Slipstream there is therefore **private by
inheritance, with no DNS change and no new cert** — just one nginx vhost update.

`deploy/studio.apit.fun.conf` is the full current studio vhost with a single `location
/slipstream/` block added (in the Tailscale-bound server block, proxying to the app). The
studio at `/` (→ `127.0.0.1:3100`) is untouched.

```bash
cd ~/slipstream
sudo cp deploy/studio.apit.fun.conf /etc/nginx/sites-available/studio.apit.fun
sudo nginx -t && sudo systemctl reload nginx
# from a tailnet device:
curl -k https://studio.apit.fun/slipstream/api/health
```

→ Private at **https://studio.apit.fun/slipstream/**. TLS is the existing self-signed
`porsche-game.crt`, so browsers warn — expected for an internal service. `nginx -t` validates
before reload, so a typo can't take the studio down.

## Going public later

Move the `location /slipstream/` block (or a dedicated subdomain vhost) to a public
`listen 443 ssl` server block, add public DNS, and rebind the app to `127.0.0.1` (set
`HOST=127.0.0.1` in `ecosystem.config.cjs`, point the vhost at `127.0.0.1:3210`), then
`pm2 restart slipstream --update-env` + reload nginx.

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
