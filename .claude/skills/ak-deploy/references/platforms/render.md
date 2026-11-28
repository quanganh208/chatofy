# Render

## CLI
No official CLI. Deploy via Git push or API.

```bash
# Git push to connected branch (auto-deploy)
git push origin main

# API trigger
curl -X POST "https://api.render.com/deploy/srv-XXXXX?key=YOUR_KEY"
```

## Config: render.yaml
```yaml
services:
  - type: web
    name: my-app
    runtime: node
    buildCommand: npm install && npm run build
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
```

## Detection
- `render.yaml` in repo root

## Pricing and limits
Read current plans, free-tier limits and credits from the official source,
https://render.com/pricing, and cite it. Do not quote figures from memory.

## Rollback
Via dashboard: Events → select previous deploy → Manual Deploy

## Best For
Full-stack apps, background workers, cron jobs, managed PostgreSQL
