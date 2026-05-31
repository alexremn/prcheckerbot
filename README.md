# GitHub PR Checker Bot

[![PR Checks](https://github.com/alexremn/github-prchecker/actions/workflows/pr.yml/badge.svg)](https://github.com/alexremn/github-prchecker/actions/workflows/pr.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](package.json)

A [Probot](https://probot.github.io/) GitHub App that validates Pull Requests using configurable checks.

## Features

- Config-driven validation rules (all checks can be enabled/disabled)
- Default config committed in the repo
- Custom config file path via env var
- Rich PR checks: labels, title/body, reviews, commits, branch freshness, and security
- GitHub Check Run output directly on PRs
- GitHub Actions for manual release creation and Docker Hub publishing

## Default Config

Default config is stored at:

- `config/default.json`

The app loads this file automatically.

## Custom Config via Env Var

To override defaults, point `PR_CHECKER_CONFIG_PATH` to a JSON file:

```bash
PR_CHECKER_CONFIG_PATH=./config/my-config.json
```

Custom config is deep-merged with `config/default.json`, so you can override only the fields you need.
You can start from `config/custom.example.json`.

> **Merge semantics:** objects are deep-merged, **arrays are replaced**. If you override
> `blockedLabels.labels` you must list every label you want — the defaults are not concatenated.
> Custom path is resolved against `process.cwd()`; in containers this is the `WORKDIR`.

Example override:

```json
{
  "checkRun": {
    "name": "My PR Gate"
  },
  "checks": {
    "minApprovals": {
      "enabled": true,
      "required": 2
    },
    "bigPrWarning": {
      "maxChanges": 800
    },
    "requiredLabels": {
      "groups": [
        {
          "anyOf": ["review passed", "code review passed", "approved by tech lead"],
          "message": "❌ Code review approval label is missing"
        },
        {
          "anyOf": ["qa passed", "qa skipped"],
          "message": "❌ QA label is missing"
        }
      ]
    }
  }
}
```

## Configurable Checks

All checks below support `enabled: true|false` and additional options from `config/default.json`:

- `labelsRequired`: minimum number of labels
- `blockedLabels`: labels that must block merge
- `titlePatternBlock`: regex for blocked title patterns (for example WIP/Draft)
- `descriptionRequired`: minimum PR description length
- `blockedReviewLabels`: labels that block review status (for example product review needed)
- `requiredLabels`: required label groups (`anyOf`)
- `minApprovals`: minimum number of active APPROVED reviews
- `baseBranchAllowed`: allowed target branches
- `bigPrWarning`: warning threshold for changed lines
- `wipCommitMessages`: regex for blocked commit messages
- `mergeCommits`: regex for blocked merge commits
- `fixupCommits`: regex for blocked `fixup!/squash!` commits
- `meaningfulCommitMessages`: minimum commit subject length + disallowed subjects/prefixes
- `branchUpToDate`: max commits behind base branch
- `sensitiveFiles`: blocked file extensions
- `sensitiveInfoInBody`: regex for sensitive data patterns in PR body
  - Pattern-based — may false-positive on PR bodies that mention `password:` / `token:` in prose.
    Disable per repo via `"sensitiveInfoInBody": { "enabled": false }` or tighten the regex.

Additional config sections:

- `checkRun.name`: GitHub Check Run name
- `api.listPerPage`: page size for PR-related API list calls

## Setup

### 1. Create a GitHub App

1. Go to GitHub Settings -> Developer settings -> GitHub Apps -> New GitHub App.
2. Configure:
   - Homepage URL: your project URL
   - Webhook URL: `https://<your-host>/api/github/webhooks`
   - Webhook secret: strong random string
3. Permissions (Repository):
   - Checks: Read & Write
   - Contents: Read-only
   - Metadata: Read-only
   - Pull requests: Read-only
4. Subscribe to events:
   - Pull request
   - Pull request review
   - Check run
5. Generate and download the private key.

### 2. Configure Environment

Copy and edit env file:

```bash
cp .env.example .env
```

Required env vars:

```bash
APP_ID=123456
WEBHOOK_SECRET=your-webhook-secret
# Production: prefer mounting the .pem file and pointing PRIVATE_KEY_PATH at it
PRIVATE_KEY_PATH=/run/secrets/github-app.pem
# Development fallback: inline key (escape newlines with \n)
# PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
```

> **`WEBHOOK_SECRET` must be set.** If left empty, Probot will not verify webhook
> signatures and the endpoint will accept arbitrary payloads.

Optional:

- `WEBHOOK_PROXY_URL`
- `LOG_LEVEL`
- `PORT`
- `PR_CHECKER_CONFIG_PATH`

### 3. Run Locally

```bash
npm install
npm run dev
```

## Docker

Build:

```bash
docker build -f .docker/Dockerfile -t prcheckerbot .
```

Run:

```bash
docker run -d \
  --name prcheckerbot \
  -p 3000:3000 \
  -e APP_ID=<app-id> \
  -e WEBHOOK_SECRET=<webhook-secret> \
  -e PRIVATE_KEY="$(cat path/to/private-key.pem)" \
  prcheckerbot
```

## GitHub Actions

### Release on Tag Push

Workflow: `.github/workflows/release.yml`

- Trigger: push of a tag matching `v*` (for example `v1.2.3`)
- Auto-generates release notes from commits/PRs since the previous tag
- Tags containing `-` (for example `v1.2.3-rc.1`) are marked as prereleases

Cut a release:

```bash
git tag v1.2.3
git push origin v1.2.3
```

The `Release` workflow creates the GitHub Release, which in turn triggers
`Publish Docker Image` to build and push the container.

### Docker Hub Publish on Release

Workflow: `.github/workflows/publish-docker.yml`

- Trigger: `release.published`
- Builds `.docker/Dockerfile`
- Pushes multi-arch image (`linux/amd64`, `linux/arm64`)

Required repository secrets:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`

Optional repository variable:

- `DOCKERHUB_REPOSITORY` (example: `your-org/prcheckerbot`)
  - If not set, defaults to `<DOCKERHUB_USERNAME>/prcheckerbot`

## Open Source Readiness

The repository includes:

- MIT license (`LICENSE`)
- Contribution guide (`CONTRIBUTING.md`)
- Code of conduct (`CODE_OF_CONDUCT.md`)
- Security policy (`SECURITY.md`)
- Issue templates (`.github/ISSUE_TEMPLATE/*`)
- Pull request template (`.github/pull_request_template.md`)

## Health Endpoints

- `GET /healthz`
- `GET /readyz`

## License

MIT
