# Heroku

## CLI
```bash
npm install -g heroku
heroku login
heroku create my-app
git push heroku main
```

## Config: Procfile
```
web: npm start
```

## Detection
- `Procfile`, `app.json`, buildpack detection

## Pricing and limits
Read current plans, free-tier limits and credits from the official source,
https://www.heroku.com/pricing, and cite it. Do not quote figures from memory.

## Rollback
```bash
heroku releases
heroku rollback v123
```

## Best For
Legacy workloads only. Not recommended for new projects — migrate to Railway/Render/Fly.
