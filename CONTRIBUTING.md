# Contributing

## Development Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy env file:
   ```bash
   cp .env.example .env
   ```
3. Configure required env vars in `.env`.
4. Start locally:
   ```bash
   npm run dev
   ```

## Pull Requests

1. Create a branch from `main`.
2. Keep changes focused and documented.
3. Update tests/docs when behavior changes.
4. Ensure `npm test` passes.
5. Open a PR using the provided template.

## Config Changes

When adding or changing checks:

1. Update `config/default.json`.
2. Keep backward-compatible defaults when possible.
3. Document new options in `README.md`.
