# Contributing

Open an issue before substantial architectural work. Keep the default deployment self-contained, never log secrets, and document execution/idempotency consequences.

1. Branch from `main`.
2. Run `npm test` and `npm run check`.
3. Include tests for behavior, not implementation details.
4. Describe security, migration, compatibility, and UI effects in the pull request.

Do not commit `.env`, databases, tokens, production payloads, or unreviewed privileged plugins.
