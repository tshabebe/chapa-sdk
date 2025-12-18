# Chapa SDK & Telegram Payment Bot (chapa-sdk)

A TypeScript starter kit and reference implementation for integrating the Chapa payment gateway.  
This repository contains a robust Express server, a Drizzle ORM database layer, Zod validation, and a production-minded payment flow that focuses on safety (no lost or manipulated transactions), webhook handling, signature verification, reconciliation, and input sanitization. It also includes a coded Telegram bot implementation (optional) built with Grammy.

This project is intended as a practical starting point for anyone building payments integrations with Chapa and needing patterns for secure, reliable processing of deposits and withdrawals.

Quick start
- Install dependencies:
  - bun install
- Run dev server (hot reload):
  - bun run dev
- Start the Telegram bot:
  - bun run bot
  - dev bot: bun run bot:dev
- Open (if server serves a UI): http://localhost:3000

Core features
- Deposit flow using Chapa payment links
  - Preset and custom amounts
  - Transaction reference generation
  - Webhook-driven confirmation and balance updates
- Withdrawal flow (with balance checks)
  - Preset and custom withdrawal amounts
  - Withdrawals currently require manual processing (status shown in the system)
- Reliable transaction handling
  - Signature verification for incoming webhooks
  - Idempotency- and reference-based protections to prevent duplicate processing
  - Transaction reconciliation service to reconcile Chapa reports with local transactions
- Security and data integrity
  - Input validation and sanitization with Zod
  - Database-level consistency using atomic transactions (Drizzle ORM)
- User management
  - Full user model (Telegram user ID, name, balance)
  - Per-user transaction history
- Database: Drizzle ORM + Postgres integration, Drizzle CLI scripts included
- Runtime / stack
  - Bun runtime
  - Express server
  - TypeScript
  - Zod for validation
  - Drizzle ORM for typed DB access
- Optional: Telegram bot built with Grammy for a ready demo interface

Why this repo is useful
- Practical, security-first patterns for webhook handling and signature verification.
- Reconciliation service to detect and resolve discrepancies between Chapa and your database.
- Examples of input validation and sanitization to reduce attack surface.
- Demonstrates how to structure payment flows so transactions are not inadvertently lost or double-processed.
- Includes DB migrations and scripts (drizzle-kit) so you can evolve your schema safely.

Repository layout (high level)
- src/
  - index.ts — main Express server entry (API / webhooks)
  - telegram-bot.ts — Telegram bot implementation (Grammy)
  - bot-runner.ts — bot runner script
  - [other service modules] — payment, webhook, reconciliation, user and transaction services
- drizzle.config.ts — Drizzle configuration
- db/ — database-related files (migrations, seeds, if present)
- utils/ — helper utilities (formatting, logging, etc.)
- TELEGRAM_BOT_README.md — detailed instructions for the included Telegram bot
- package.json — scripts:
  - dev, bot, bot:dev, start
  - many drizzle-kit tasks: db:push, db:migrate, db:generate, db:drop, etc.

Important environment variables
- Telegram (if using the bot)
  - TELEGRAM_BOT_TOKEN
- Chapa
  - CHAPA_AUTH_KEY (Chapa secret key)
  - RETURN_URL (redirect URL after payments)
  - CHAPA_WEBHOOK_SECRET (shared secret used to sign webhooks; recommended)
- Database
  - DATABASE_URL (Postgres connection)
- Other
  - PORT, NODE_ENV, and any logging, monitoring, or secrets-manager configs

Missing / recommended improvements (what to add next)
These are items that improve production readiness and are commonly missing in early demos — consider adding them if you plan to go live:

- Stronger webhook hardening
  - Centralized middleware for signature verification
  - Strict timestamp checks (reject old/late webhooks)
  - Replay protection and nonce tracking
- Robust idempotency
  - Idempotency keys for all externally-triggered operations
  - Database-enforced uniqueness for txRef and payment references
- Background reconciliation & recovery service
  - Scheduled (cron) reconciliation that compares Chapa / provider statements with local transactions
  - Retry and alerting on mismatches
  - Auto-heal logic where safe (or safe manual reconciliation processes)
- Observability and alerting
  - Structured request and audit logging for payments
  - Metrics (payment success rate, webhook latency/failure)
  - Alerts for failed reconciliation, webhook signature failures, or suspicious patterns
- Automated testing
  - Unit tests for payment logic, signature verification, and reconciliation
  - Integration tests that simulate webhook deliveries and Chapa responses
- CI/CD
  - Linting, type checking, and test runs in CI (GitHub Actions)
  - Safe deployment scripts and migration workflows
- Secrets & config
  - Move secrets to a secrets manager in production; do not commit .env
- Input sanitization & validation
  - Extend Zod schemas for all incoming routes and webhook payloads
  - Strict parsing of numeric amounts and currency fields
- Rate limiting & abuse controls
  - Prevent abuse of endpoints (especially webhook endpoints and public APIs)
- Documentation
  - API reference for server endpoints (webhook contract, payment request/response models)
  - Quickstart for deploying to a cloud provider (with HTTPS and webhook endpoints)
- Optional: Remove or separate Telegram bot from core SDK
  - The Telegram bot is a demo — consider extracting into a separate repo or package if you want a pure SDK

Security notes (practical tips)
- Verify Chapa webhook signatures for every webhook and log failures.
- Treat webhook endpoints as public — protect them with a shared secret and rate limiting.
- Use database transactions when marking payments as verified and when updating balances.
- Persist raw webhook payloads and verification results for future audits.
- Sanitize any user-provided metadata before storing or reflecting it in notifications.

How this repository handles common pain points
- Webhooks: signed verification and idempotency to avoid duplicate processing
- Signature verification: middleware and centralized helpers to validate Chapa signatures
- Transaction reconciliation: background job/service that reconciles payments and flags mismatches
- Input sanitization: Zod schemas for all user inputs and webhook payloads
- User management: integrated user and transaction models so every payment maps to an owner

Getting involved / contributing
- If you want to improve this starter kit, good first steps:
  - Add tests for webhook verification and reconciliation logic
  - Add CI that runs lint, type checks, and tests
  - Harden webhook handling (timestamp checks, replay protection)
  - Add docs for the webhook payload format, sample payloads, and signature examples
- Prefer opening issues describing the feature or bug, then submit PRs touching one concern at a time.

Notes about the Telegram bot
- The repo includes a working Telegram bot implementation to demo the flows, but the core SDK / server is independent — you can ignore the bot if you only need server-side payment integration.

License
- No license file included in this repo. Add a LICENSE if you plan to open source.

If you want, I can:
- Draft an improved README.md that replaces the current minimal file (I can prepare a file ready to commit).
- Extract and summarize the exact exported APIs and important functions from src/ so we can include usage examples.
- Add a checklist of tasks to make this production-ready (tests, CI, observability).

Which would you like me to do next? I can produce the updated README file and show it here ready-to-commit.
