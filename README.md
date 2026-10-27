# FlowForge Automation (working name)

A self-hosted visual workflow automation MVP for manual and webhook-triggered HTTP workflows. The name is provisional because “FlowForge” has been used by other software projects; choose a legally reviewed identity before public launch.

## What is implemented

- Secure first-run administrator setup, sign-in/out, HttpOnly sessions, CSRF checks, and login throttling
- One server-authorized workspace per initial administrator (single-user MVP)
- Visual directed-acyclic workflow builder with draggable, reconnectable, duplicable nodes
- Manual and webhook triggers with rotatable, one-time-display webhook secrets
- HTTP request and safe JSON mapping nodes
- Draft revisions, graph validation, immutable published versions, activation/deactivation API
- SQLite-backed queue and a separate worker process
- Execution and step-attempt history with timings, inputs, outputs, and errors
- API-key and bearer-token credentials encrypted with AES-256-GCM, with replacement and guarded deletion
- Private/link-local outbound HTTP blocking by default, timeouts, redirect blocking, request limits, and security headers
- Docker Compose deployment, health endpoint, tests, and open-source project files

Not implemented: schedules, branches, loops, automatic retries, cancellation, SMTP, multiple users, invitations, PostgreSQL/Redis, plugin loading, high availability, or distributed workers. The UI does not advertise them as available.

## Local quick start

Requires Node.js 22.5+ because the MVP uses the built-in SQLite module.

```bash
cp .env.example .env
# Load variables with your preferred shell/environment manager.
npm run dev
```

In a second terminal:

```bash
npm run worker
```

Open <http://localhost:4080>, create the first administrator, create a workflow, validate it, publish version 1, and run it. The default example target is `https://example.com`; replace it with your real endpoint.

## Docker Compose

```bash
cp .env.example .env
# Replace ENCRYPTION_KEY with: openssl rand -base64 32
docker compose up --build
```

Data persists in the `flowforge-data` volume. Set `SECURE_COOKIES=true` only after HTTPS is configured. Do not expose port 4080 directly to the internet; terminate HTTPS at Caddy, Traefik, or nginx, forward trusted requests to the web container, and apply host-level firewalling.

## Architecture

```text
Browser ──session/CSRF──> Node HTTP/API ──> SQLite WAL
                              │                 ▲
Webhook ──POST /hooks/:key────┘                 │ claim/persist
                                                │
                                        Separate worker ──> allowed HTTP target
```

The dependency-free Node server serves the SPA and versioned API. SQLite stores users, memberships, drafts, immutable versions, encrypted credentials, queued executions, attempts, and audit events. A separate process atomically claims queued rows and executes the exact published version referenced by the execution.

SQLite is intentional for a simple single-host deployment. It is not a multi-host queue. A later distributed edition should use PostgreSQL for durable state and a purpose-built queue with leases/heartbeats.

### Execution lifecycle and semantics

1. An editable draft is validated as a connected DAG with exactly one trigger.
2. Publishing copies it to an immutable numbered version and activates the workflow.
3. Manual or webhook input creates a `queued` execution referencing that version.
4. The worker claims it, records each step attempt, and passes outputs by node ID.
5. The execution becomes `succeeded` or `failed`; draft edits never affect it.

Jobs are **at-least-once after worker recovery**, not exactly-once. A worker restart may requeue a run that was marked running for over five minutes. If it stopped after an external server accepted an HTTP request but before completion was persisted, that side effect may repeat. Automatic retries are deliberately absent. Design endpoints with idempotency keys and inspect failures before manually creating another run.

Deactivating or editing a workflow does not alter queued/running executions. Deletion is not exposed in the MVP. Duplicate webhook requests create distinct runs; callers should include their own idempotency identifier until server-side deduplication is added.

## Expressions

Mapping and HTTP configuration support path substitution only—there is no `eval` or arbitrary code:

```json
{
  "email": "{{trigger.customer.email}}",
  "status": "{{steps.check_order.status}}",
  "execution": "{{execution.id}}"
}
```

Missing paths fail the step with a useful error. Ordinary outputs cannot access credential plaintext.

## Security boundaries

- The MVP is single-user/single-workspace. It enforces workspace IDs server-side but does not claim tested multi-tenant isolation.
- Secrets are AES-256-GCM encrypted. `ENCRYPTION_KEY` stays outside SQLite. Back up the key separately; losing it makes credentials unrecoverable. Rotate by decrypting/re-encrypting every record during a maintenance window (no automated rotation yet).
- Private, loopback, link-local, and metadata-range destinations are blocked by default after DNS resolution. Redirects are not followed. Set `ALLOW_PRIVATE_NETWORK=true` only for a trusted, isolated instance; this weakens SSRF protection. DNS rebinding defenses are not complete enough for hostile multi-user deployments.
- Webhook URLs contain an unguessable identifier. Create a secret from the webhook node inspector and copy it immediately; only its SHA-256 digest is stored. Callers send it as `X-FlowForge-Secret`. Use an authenticating reverse proxy as additional defense for internet-facing endpoints.
- Workflow payloads are retained without an automatic expiry in this MVP. They may contain sensitive data. Restrict volume access and delete/rotate the database according to your policy.
- Containers run as a non-root user. This is defense-in-depth, not a security audit. Review dependencies, proxy configuration, network policy, and host isolation before public exposure.

## API

All `/api/*` routes except health, setup status, setup, and login require the session cookie. Mutating routes also require `X-CSRF-Token` from `/api/me`.

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness/readiness |
| POST | `/api/setup` | Create the one initial owner |
| POST | `/api/login`, `/api/logout` | Session lifecycle |
| GET/POST | `/api/workflows` | List/create workflows |
| GET/PUT | `/api/workflows/:id` | Read/update a revisioned draft |
| POST | `/api/workflows/:id/validate` | Validate graph |
| POST | `/api/workflows/:id/publish` | Publish immutable version |
| POST | `/api/workflows/:id/run` | Queue manual execution |
| POST/DELETE | `/api/workflows/:id/webhook-secret` | Rotate/remove webhook secret |
| POST | `/hooks/:key` | Queue webhook execution |
| GET | `/api/executions`, `/api/executions/:id` | Execution history/detail |
| GET/POST | `/api/credentials` | List masked metadata/create encrypted secret |
| PUT/DELETE | `/api/credentials/:id` | Replace or delete a credential |

API shape is experimental until v1. Lists are capped at 100 executions; cursor pagination is planned.

## Operations

Back up both the SQLite data volume and `ENCRYPTION_KEY`. For a consistent online backup, use SQLite's backup command/API rather than copying active WAL files individually. Test restoration with the same key. For upgrades, back up first, pull the tagged release, rebuild, and start the web process before workers. Roll back to the prior image and compatible database backup if a migration cannot be reversed.

One worker is the supported configuration. SQLite claims prevent common duplicate pickup, but horizontal worker scaling and graceful in-flight shutdown need more hardening. JSON logs go to stdout; configure container-log rotation. `/api/health` verifies the process and opened database.

## Tests

```bash
npm test
npm run check
```

The suite covers authenticated setup and CSRF enforcement, draft validation, immutable version pinning, trigger-type enforcement, authenticated webhooks, graph restrictions, cycle detection, a real worker execution against a local HTTP service, safe mapping, password hashing, credential authenticated encryption, secret redaction, and database migrations.

## Roadmap

1. Schedule trigger, conditions, manual retry warnings, cancellation checkpoints, SMTP test sink, retention settings.
2. Idempotency keys, richer credential dependency analysis, audit-history UI, and import/export without secrets.
3. PostgreSQL plus leased queue, multi-user roles/invitations with isolation tests, metrics, plugin SDK and signed integrations.
4. High availability, sandboxed code nodes, parallel branches, human approvals, enterprise identity.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and [CHANGELOG.md](CHANGELOG.md).

## License

MIT. No third-party client assets or integrations are bundled.
