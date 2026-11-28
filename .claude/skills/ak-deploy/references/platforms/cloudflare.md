# Cloudflare Pages / Workers

## CLI
```bash
npm install -g wrangler
wrangler login

# Pages
wrangler pages deploy ./dist --project-name my-app

# Workers
wrangler deploy
```

## Config: wrangler.toml
```toml
name = "my-app"
compatibility_date = "2024-01-01"

# For Workers:
# main = "src/index.ts"
# [vars]
# ENVIRONMENT = "production"
```

## Detection
- `wrangler.toml`, `wrangler.json`

## Pricing and limits
Read current plans, free-tier limits and credits from the official source,
https://www.cloudflare.com/plans/developer-platform/, and cite it. Do not quote figures from memory.

## Rollback
```bash
wrangler pages deployment list --project-name my-app
wrangler rollback [deployment-id]
```

## Best For
Edge functions, static sites with global CDN, serverless at edge
