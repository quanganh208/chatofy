# Coolify (Self-Hosted)

## Setup
```bash
# Install on VPS
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

## Deploy
```bash
# Via API
curl -X POST "https://your-coolify.com/api/v1/deploy" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"uuid": "APP_UUID"}'

# Or via dashboard / Git webhook (auto-deploy)
```

## Detection
- `docker-compose.yml` + Coolify dashboard reference
- Dockerfile, buildpack detection

## Pricing and limits
Read current plans, free-tier limits and credits from the official source,
https://coolify.io/pricing, and cite it. Do not quote figures from memory.

## Rollback
Via dashboard: select previous deployment

## Best For
Teams wanting Heroku-like PaaS on own server. 280+ one-click services.
Multi-server, Docker Swarm support, free SSL via Let's Encrypt.
