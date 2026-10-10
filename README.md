# Dash

![Dash - your proactive assistant](docs/images/github-cover/dash-cover.png)

**Your assistant. Less on your plate.**

Created by **Michael Goldstein**. Dash is a proactive personal assistant you can message to get things done. It includes a Next.js backend and web-rendered interface, an iPhone app, and a persistent agent runtime. The current end-user experience is iOS-first: the iPhone shell handles sign-in and opens the workspace; an ordinary browser shows the public landing page.

This is a self-hosted source distribution. You supply the database, hosting, provider accounts and API keys. It does not connect to the original Dash service. Model inference, cloud browsing, sandbox execution and phone calls can incur charges on your provider accounts.

## What is included

- Conversations with durable task history, files, replies and background execution.
- Google account connections for Gmail and Calendar, plus optional Composio integrations.
- Browserless cloud browsing and a separate E2B code workspace.
- Proactive suggestions, scheduled tasks, waits and iPhone notifications.
- Optional outbound phone calls through Resia.
- A native iOS shell with device permissions, sharing, notification replies and a device-local credential vault.

## Requirements

- Node.js 22 and pnpm 10.32.1 (the version specified in `package.json`).
- For the full test suite: Python 3 on macOS or Linux; browser-controller fixtures use its standard library.
- PostgreSQL, including the `pgcrypto` extension, and the `psql` command-line client. PostgreSQL 16 is a suitable starting point.
- A Google OAuth web client for the documented sign-in flow.
- An OpenAI API key with access to the configured models for the default assistant and proactive features.
- Optional provider accounts for the features listed below.
- For the iPhone app: macOS and Xcode with an iOS simulator. Device signing and distribution require your own Apple configuration.

## Local setup

Run these commands from the repository root.

### 1. Install dependencies

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
```

The examples below assume a POSIX shell. `.env.local` is ignored by Git. Never put secrets in variables beginning with `NEXT_PUBLIC_`; those values are included in the browser build.

### 2. Configure the minimum environment

Generate a session/encryption secret:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Set these values in `.env.local`:

```dotenv
AUTH_SECRET=your-generated-secret
DATABASE_URL=postgresql://YOUR_USER:YOUR_PASSWORD@localhost:5432/dash
AUTH_GOOGLE_ID=your-google-web-client-id
AUTH_GOOGLE_SECRET=your-google-web-client-secret
OPENAI_API_KEY=your-openai-api-key
NEXT_PUBLIC_APP_ORIGIN=http://localhost:3000
NEXT_PUBLIC_SUPPORT_EMAIL=your-support-address
```

Create an empty `dash` database using your PostgreSQL tools. The migration user must be able to create tables, types and the `pgcrypto` extension. Keep `AUTH_SECRET` stable: changing it affects sessions and encrypted application data.

The main chat defaults to `gemini-3.7-flash` through Google AI Studio; the free tier has provider-set quotas and can change. Configure `GOOGLE_GENERATIVE_AI_API_KEY` (or `GOOGLE_API_KEY`) to use it. Proactive work and some background research still use their own configured providers. Main model defaults are in [`lib/agent-model-settings.ts`](lib/agent-model-settings.ts), with saved deployment settings taking precedence. Proactive settings are in [`lib/proactive/engine/model.ts`](lib/proactive/engine/model.ts). Set `DASH_AGENT_MODEL_ID` and `DASH_AGENT_PROVIDER` to override saved/global main-agent settings. The legacy `OPENAI_AGENT_MODEL` override applies when `DASH_AGENT_MODEL_ID` is empty. Set `PROACTIVE_MODEL_ID` independently for proactive work and `OPENAI_TRANSCRIPTION_MODEL` for voice. Restart after changing these values. Models must support the tool, structured-output and reasoning options used by the selected path; model availability is not verified by a local build. There is no user-facing model-admin page.

### 3. Configure Google sign-in

In your Google Cloud project, configure the OAuth consent screen, enable the Gmail and Google Calendar APIs, and create a **Web application** OAuth client. Add your test accounts while the OAuth app is in testing.

For local development, register these exact redirect URIs:

```text
http://localhost:3000/api/auth/callback/google
http://localhost:3000/api/connections/google/callback
```

Use the same hostname when opening Dash. For deployment, register the equivalent URLs on your HTTPS origin. Google verification requirements depend on the scopes and audience of your OAuth app. See the [Google OAuth web-server guide](https://developers.google.com/identity/protocols/oauth2/web-server).

The email/password registration endpoint is disabled. Existing local password accounts remain supported, and Apple sign-in is optional; Google is the simplest documented setup for a new installation.

### 4. Initialize the database

```sh
node --env-file=.env.local -e 'require("node:child_process").execFileSync("pnpm", ["db:migrate"], {stdio: "inherit"})'
```

This loads `DATABASE_URL` into the migration process and runs the migration list in `package.json`. Each `psql` invocation uses `-X -v ON_ERROR_STOP=1`, so user startup files cannot alter migration behavior and SQL errors stop the sequence. Next.js loads `.env.local` automatically, but a bare `psql` or `pnpm db:migrate` command does not load that file for you.

Use this command for a **new, empty database**. This is an ordered SQL script list, not a migration-tracking framework; the initial migration creates types and tables that cannot simply be recreated. For upgrades, back up the database and apply only the required pending migrations in order. Do not blindly run every file: some numbered migrations are explicitly post-deployment transitions and are excluded from the startup list.

### 5. Start the web app

```sh
pnpm dev
```

Open [localhost:3000](http://localhost:3000) to verify that the landing page loads. Continue with the [iPhone app setup](#iphone-app) below to sign in and use the workspace. The browser `/login` page explains the iPhone sign-in flow; it is not a browser-only workspace. For a development-only visual preview, `http://localhost:3000/?uiPreview=1` shows sample workspace data; it is not a real account or a working end-to-end setup.

With no Inngest event key, interactive tasks can execute in the web process. This is useful for initial development, but it does not provide durable scheduled/background work. Keep the web process running and configure Inngest for proactive jobs, schedules and recovery.

## Background work with Inngest

For local background execution, set these values in `.env.local`, then restart Dash:

```dotenv
INNGEST_DEV=1
INNGEST_BASE_URL=http://localhost:8288
INNGEST_EVENT_KEY=local-development-only
```

Leave `INNGEST_SIGNING_KEY` empty locally. In another terminal, start the [Inngest Dev Server](https://www.inngest.com/docs/local-development):

```sh
npx --ignore-scripts=false inngest-cli@latest dev --no-discovery -u http://localhost:3000/api/inngest
```

Open [localhost:8288](http://localhost:8288) and confirm the app and functions are registered. In production, remove the local development settings and configure your own Inngest event/signing keys and deployed `/api/inngest` endpoint.

Calling and proactive feature access are **on for everyone by default**. They still require provider configuration, completed onboarding and relevant source/device permissions. Explicit saved feature policies are respected. Rich structured replies (including trip cards, timelines and checklists) are also on by default. There are no paid plans, app-level usage credits or Stripe billing. See [installation configuration](docs/INSTALLATION_CONFIG.md) for overrides.

## Optional providers

| Capability | Configuration | Notes |
|---|---|---|
| Cloud browser | `BROWSERLESS_API_TOKEN`, `E2B_API_KEY` | Browserless runs Chrome; an isolated E2B runtime runs the trusted controller. |
| Code execution and document generation | `E2B_API_KEY`, `E2B_TEMPLATE_ID` | Build the template below. The code workspace has internet access but no injected application credentials. |
| Web search | `EXA_API_KEY` | Used by the built-in search tool. |
| Other model providers | `ANTHROPIC_API_KEY`, `META_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY` | Only needed by paths configured to use those providers; supplying a key alone does not switch models. |
| Additional app connections | `COMPOSIO_API_KEY` | Users connect their own accounts through the app. Google has a separate built-in integration. |
| Phone calls | `RESIA_API_KEY`, `RESIA_CALL_AGENT_ID` | Requires a funded provider account and a configured agent. Optional callback: `RESIA_CALL_ENDED_WEBHOOK_URL`. |
| Weather and travel | `OPENWEATHER_API_KEY`, `GOOGLE_ROUTES_API_KEY` | Used by applicable weather/travel paths. |
| Apple sign-in | `AUTH_APPLE_ID`, `AUTH_APPLE_SECRET` | Requires your own Apple service/sign-in configuration. |
| iPhone push notifications | `APNS_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY_BASE64`, `APNS_BUNDLE_ID` | Match your app identity and provisioning. |

Provider keys are server-only. Do not embed them in the native app or expose them with `NEXT_PUBLIC_` names.

### E2B template

After setting `E2B_API_KEY`, run:

```sh
pnpm sandbox:build
```

Copy the returned template ID into `E2B_TEMPLATE_ID` and restart Dash. This provisions a provider resource and may incur charges. The template includes Python, Node.js, Chromium, LibreOffice and document/data libraries. The separate trusted browser controller does not use this document-generation template.

### Browserless

Configure `BROWSERLESS_HOST`, `BROWSERLESS_SESSION_TIMEOUT_MS` and `BROWSERLESS_PROXY_COUNTRY` if needed. The supplied session timeout is 1,800,000 ms (30 minutes), also the code's upper bound. Your provider plan must support the features and duration you configure, including profiles, reconnects and the proxy settings.

Profiles preserve account-specific browser cookies. Terminal execution and the browser controller are separate environments. See [browser runtime details](docs/BROWSER_RUNTIME.md).

### Google push updates

For automatic Gmail/Calendar updates, configure a public HTTPS endpoint and set:

```dotenv
ENABLE_GOOGLE_PUSH=true
GOOGLE_PUSH_BASE_URL=https://your-deployment.example
GOOGLE_GMAIL_PUBSUB_TOPIC=projects/YOUR_PROJECT/topics/YOUR_TOPIC
GOOGLE_GMAIL_WEBHOOK_SECRET=your-random-secret
GOOGLE_CALENDAR_WEBHOOK_SECRET=another-random-secret
CRON_SECRET=another-random-secret
```

Grant `gmail-api-push@system.gserviceaccount.com` publish access to your Pub/Sub topic and configure its push subscription to call `/api/webhooks/google/gmail?token=<GOOGLE_GMAIL_WEBHOOK_SECRET>`. Calendar channels are registered by the app. Keep `/api/cron/google-watches` scheduled to renew watches; `vercel.json` includes that schedule. Inngest handles the background jobs. The old polling path remains disabled with `ENABLE_BACKGROUND_SCAN=false`.

## iPhone app

1. Start the local web app and open `ios/DecisionFeed.xcodeproj` in Xcode.
2. Select the `DecisionFeed` scheme, Debug configuration and an iPhone simulator.
3. Build and run. Debug loads `http://localhost:3000`.
4. Use Google sign-in in the native shell, complete onboarding and confirm that a simple chat works before enabling additional providers.

A physical phone cannot reach your Mac through its own `localhost`; configure a reachable development origin and matching OAuth callbacks when testing on a device. For distribution, replace the `com.example.dash` identifiers, app group, signing team and Release host with your own configuration. See [iOS setup](ios/README.md) and [installation-specific settings](docs/INSTALLATION_CONFIG.md#native-app).

## Deployment

Configure your own hosting environment and database, public origin, OAuth callbacks, secrets and provider accounts. Set public variables before building:

```sh
pnpm build
pnpm start
```

Apply migrations `0039_deletion_cleanup.sql` and `0040_mobile_handoff_binding.sql` when upgrading an existing installation. Deploy the matching iPhone wrapper version 3; older wrappers cannot complete the new device-bound sign-in flow.

The app requires a Node.js server; it is not a static export. Configure Inngest and scheduled endpoints separately. The optional GitHub deployment workflow registers Inngest only when the repository variable `APP_ORIGIN` is set to your production origin.

Use your own support contact and review the included Terms and Privacy pages for your deployment. They are application content, not a substitute for describing your actual providers and data practices.

## Data and action boundaries

PostgreSQL stores conversations, messages, actions, artifacts, connections and scheduling state. In-memory test/development implementations exist, but they are not a replacement for the database in a complete installation. Device-vault secrets use the native Keychain and a separate secure-filling flow.

The agent can act on connected accounts. Email sends and purchases use explicit approval paths; other authorized operations can execute directly. Do not assume every external change will prompt again. Keep account permissions and provider credentials limited to the capabilities you intend to run.

No product analytics or administrator chat viewer is included. Hosting/database access can still expose stored data, and operational/provider logs have their own retention. Removing application telemetry does not make server-stored conversations inaccessible to an operator.

## Checks and project map

```sh
pnpm test
pnpm lint
pnpm build
```

`pnpm test` runs the unit/contract suite. Database and live-provider tests require explicit environment opt-ins and may otherwise be skipped. `pnpm test:database` runs the PostgreSQL suites against a migrated, disposable local `dash_security_test` database and a separate empty `dash_capacity_test` database; it refuses other hosts/database names. The GitHub CI workflow creates these and runs the checks automatically. `pnpm lint` is the TypeScript check. Browser tests use Playwright through `pnpm test:browser`; check their fixtures and server requirements before running. Live evaluation scripts can call paid providers or connected services.

- `app/`: web UI and API routes.
- `lib/harness/`: agent execution, tools, persistence, browsing and sandbox support.
- `lib/proactive/`: proactive discovery and scheduling.
- `db/migrations/`: SQL schema and migration files.
- `ios/`: native app and extensions.
- `tests/`: unit, integration and browser checks.

See [DEVELOPMENT.md](DEVELOPMENT.md) for implementation details. See the [release review](docs/RELEASE_REVIEW.md) for local installation checks and remaining asset-license/live-service work. Successful local builds do not verify your OAuth, provider accounts or deployment.

## License and credit

Project code is licensed under the [MIT License](LICENSE), copyright © 2026 **Michael Goldstein**. You may use, modify and redistribute it, including commercially, provided you retain the copyright and license notice as required by MIT. A visible in-app credit is appreciated but is not an additional license requirement.

Bundled third-party code and assets retain their own license terms. Preserve their notices, including [bundled fonts](public/fonts/README.md), [card-network assets](public/card-networks/LICENSE), [the iPhone frame](public/landing/iphone-frame-LICENSE.txt), and [cursor-motion attribution](docs/licenses/cua-cursor-motion.txt). The project license does not replace dependency or third-party asset licenses.
