# AWS (Amplify / S3 / ECS)

## Amplify Hosting
```bash
npm install -g @aws-amplify/cli
amplify configure
amplify init
amplify publish
```

### Config: amplify.yml
```yaml
version: 1
frontend:
  phases:
    preBuild:
      commands:
        - npm ci
    build:
      commands:
        - npm run build
  artifacts:
    baseDirectory: dist
    files:
      - '**/*'
  cache:
    paths:
      - node_modules/**/*
```

## S3 Static Hosting
```bash
aws s3 sync ./dist s3://BUCKET_NAME --delete
aws s3 website s3://BUCKET_NAME --index-document index.html --error-document error.html
```

## ECS Fargate
```bash
aws ecs update-service --cluster CLUSTER --service SERVICE --force-new-deployment
```
Config: `task-definition.json`.

## Pricing and limits
Read current pricing and free-tier terms from the product page and cite it:
https://aws.amazon.com/amplify/pricing/, https://aws.amazon.com/s3/pricing/ or
https://aws.amazon.com/fargate/pricing/. Do not quote figures from memory.

## Detection
- `amplify.yml`, `buildspec.yml` → Amplify
- S3 bucket policy JSON → S3
- `task-definition.json` → ECS

## Best For
- Amplify: static sites + serverless backends
- S3 + CloudFront: cheapest static at scale
- ECS: enterprise containerized workloads
