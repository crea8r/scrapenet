# DigitalOcean deployment (minimal, 1GB RAM)

This deploys only the waitlist web (port 8080).

## On the droplet

1) Install Node 22 + pnpm (corepack)
2) Clone repo to `/opt/scrapenet`
3) `pnpm install --prod`
4) Install systemd unit `scrapenet-waitlist.service`

## Ports

- 8080/tcp: waitlist web

## Data

- `/var/lib/scrapenet-waitlist/signups.jsonl`
