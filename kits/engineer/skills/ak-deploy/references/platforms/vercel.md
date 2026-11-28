# Vercel

## CLI
```bash
npm i -g vercel
vercel login
vercel              # preview
vercel --prod       # production
```

## Config: vercel.json
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": null,
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

## Detection
- `vercel.json`, `.vercel/` directory
- Auto-detects Next.js, Vite, Remix frameworks

## Pricing and limits
Read current plans, free-tier limits and credits from the official source,
https://vercel.com/pricing, and cite it. Do not quote figures from memory.

## Rollback
```bash
vercel rollback [deployment-url]
```

## Best For
Frontend frameworks (Next.js first-class), serverless APIs, SPAs
