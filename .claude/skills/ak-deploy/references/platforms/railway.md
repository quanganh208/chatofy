# Railway

## CLI
```bash
npm i -g @railway/cli
# or: curl -fsSL https://railway.com/install.sh | sh
railway login
railway up
```

## Config: railway.toml
```toml
[build]
buildCommand = "npm run build"

[deploy]
startCommand = "npm start"
healthcheckPath = "/"
restartPolicyType = "ON_FAILURE"
```

## Detection
- `railway.toml`, `railway.json`
- Auto-detects via Railpack (language/framework)

## Pricing and limits
Read current plans, free-tier limits and credits from the official source,
https://railway.com/pricing, and cite it. Do not quote figures from memory.

## Rollback
```bash
railway service rollback
# Or via dashboard: Deployments → select previous
```

## Best For
Full-stack apps, databases, background workers, private networking
