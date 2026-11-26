# Netlify

## CLI
```bash
npm install -g netlify-cli
netlify login
netlify deploy          # draft
netlify deploy --prod   # production
netlify deploy --dir=dist --prod  # specify build dir
```

## Config: netlify.toml
```toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

## Detection
- `netlify.toml`, `_redirects`, `_headers` files

## Pricing and limits
Read current plans, free-tier limits and credits from the official source,
https://www.netlify.com/pricing/, and cite it. Do not quote figures from memory.

## Rollback
```bash
netlify deploy --prod --alias=DEPLOY_ID
# Or via dashboard: Deploys → Published deploy → select previous
```

## Best For
Static sites, JAMstack, serverless functions
