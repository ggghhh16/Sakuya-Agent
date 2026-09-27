# Sakuya Agent

**English** | [简体中文](README.zh-CN.md)

A local agent workspace for multi-turn chat, deep research, GitHub issue investigation, support tickets, tasks, and calendars. Built with React, TypeScript, Electron, FastAPI, and LangGraph.

Sakuya opens to a minimal dark chat interface. Work mode keeps chat available while a side panel displays tasks, calendars, research, or diagnostics. Workspace data is stored locally.

## Interface languages

Open the language menu beside the Sakuya title to choose English, Simplified Chinese, or Japanese. Theme settings are beside it; the light/dark toggle remains on the right. Sign-in and registration also include a language button.

- The initial language follows the browser: Chinese for Chinese locales, Japanese for Japanese locales, English otherwise.
- Your selection persists in the current browser or desktop profile and synchronizes across tabs on the same origin.
- Switching updates navigation, forms, settings, status labels, and calendar dates without resetting drafts or reloading the page.
- User input, existing conversations, reports, source excerpts, and raw execution logs retain their original language. Interface language does not force a model's response language.

## Features

- **Chat:** persistent multi-turn conversations, history search, rename, reorder, soft deletion with undo, and cancellation.
- **Model settings:** multiple Chat Completions-compatible providers, model discovery, model selection, and optional reasoning effort.
- **Deep research:** planning, document and web retrieval, bounded follow-up collection, cited Markdown reports, and optional reviewed experiments.
- **Issue investigation:** inspect a GitHub repository at a fixed commit, read candidate files and recent issues, and report possible causes with source links.
- **Support tickets:** available from Settings, with user submissions, administrator assignment, status and priority management, public replies, and private internal notes.
- **Tasks and calendars:** lists, priorities, day/week/month views, adjustable 1–14 day ranges, all-day events, drag and resize, and five-minute scheduling increments. Calendar editors appear beside events and dismiss on outside clicks. Title changes save automatically; other existing-event fields use Save.
- **Integrations:** link lists to Google Calendar and Dida or international TickTick; optionally let a tool-capable chat model manage the planner.
- **Durable execution:** SQLite task queues, a separate worker, LangGraph checkpoints, review and resume, retries, cancellation, and recovery after worker heartbeat expiry.

## Getting started on Windows

Development and packaging require **Node.js 22.12+** and **Python 3.11+**. Windows is the supported packaging target. The setup script installs JavaScript dependencies, the Python environment, and Electron.

```powershell
git clone https://github.com/ggghhh16/Sakuya-Agent.git
cd Sakuya-Agent
.\scripts\setup.ps1
Copy-Item .env.example .env
```

This repository contains source code, not prebuilt binaries or user data.

### Configure authentication first

Sign-in requires Cloudflare Turnstile. Public email registration additionally requires SMTP. There is no production CAPTCHA bypass, and the first registered account does not automatically become an administrator.

1. Fill in `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, and `TURNSTILE_HOSTNAMES` in `.env`. Allow the hostname used to open Sakuya in the Turnstile dashboard.
2. To enable registration, configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURITY`, `SMTP_FROM`, `SMTP_USERNAME`, and `SMTP_PASSWORD`. SMTP requires `starttls` or `ssl`.
3. Initialize an administrator locally. The script prompts for a password; there is no network administrator-registration endpoint.

   ```powershell
   .\scripts\setup-admin.ps1 -Email 'you@example.com'
   ```

4. Start the development services:

   ```powershell
   node scripts/dev.mjs
   ```

Open `http://127.0.0.1:5173`. The local API listens at `http://127.0.0.1:8120`.

Regular accounts have separate chat, research, planner, integration, and model settings. Users can submit and edit their own tickets and read public replies. Administrators manage all tickets and internal notes. Everyone must connect to the same backend to share ticket handling.

### Connect a model

Open **Settings**, enter a provider name, API base URL, and API key, then load its models or enter a model ID manually. Add models to the chat model list. Enable reasoning effort only for models explicitly supporting `reasoning_effort`.

The app supports **Chat Completions-compatible APIs**, not every provider's native protocol. Research workflows require models capable of the expected JSON output.

Administrators can also configure environment defaults:

```dotenv
MODEL_BASE_URL=https://your-provider.example/v1
MODEL_NAME=your-model-id
MODEL_API_KEY=your-key
TAVILY_API_KEY=your-search-key
GITHUB_TOKEN=optional-read-only-token
```

Saved settings take precedence over environment defaults. Regular accounts configure their own models and do not inherit administrator keys.

After authentication, **Demo mode** exercises workflows without a model key. Demo output is labeled and does not represent real inference or experiments. Disable Demo mode to call configured services. Without Tavily, the app can read saved documents and supplied URLs on allowed domains, but does not perform automatic external searches.

## Desktop and browser launchers

```powershell
node scripts/package.mjs
```

This builds the web interface, bundles the Python backend with PyInstaller, packages Electron, and creates `Sakuya Desktop.lnk` and `Sakuya Web.lnk` in the project root.

- **Desktop:** open `Sakuya Desktop.lnk`, or `release-security/win-unpacked/Sakuya Agent.exe`.
- **Browser:** open `Sakuya Web.lnk`. It starts the local service and opens `http://127.0.0.1:8120`.
- `start.ps1` starts the packaged desktop app; `start.ps1 --web` starts browser mode.
- Browser mode keeps the service in the system tray. Closing the browser does not stop it; exit Sakuya from the tray to stop the service it owns.
- Closing the desktop window stops its service unless browser mode remains active. Compatible existing service instances are reused.

The complete packaged folder contains Python, dependencies, and web assets. End users do not need Node.js or Python. Copy the **entire `win-unpacked` folder**, not only the executable. The app is unsigned.

A build launched from this source workspace reuses its existing `.data` directory when present. A copied application uses the current user's application-data directory. Keep authentication configuration available to that backend; builds do not include your `.env` or accounts. A browser bookmark cannot restart a stopped local application.

## Data and security boundaries

- The API binds to loopback. This is a local application, not a supported public deployment. Do not expose its port directly to the internet.
- Passwords use salted scrypt hashes. Sessions use random tokens, with only digests stored server-side. Remembered sessions last up to 30 days; ordinary sessions have a 24-hour server-side maximum.
- Model and integration credentials are stored locally in plaintext backend configuration. They are not returned to the browser. Protect the data directory with OS access controls.
- `.env`, `.data`, dependencies, test output, caches, shortcuts, and packaged binaries are excluded from Git. Never upload user-data folders with the source.
- Electron disables Node integration and enables context isolation and sandboxing. External HTTPS links open in the system browser.
- Research requests use an allowed-host list. Direct requests reject local/private targets; redirects are rechecked. Trusted HTTPS proxies resolve allowed public domains on the proxy side.
- Public ticket replies appear in the ticket and do **not** send email notifications. SMTP is currently used for registration codes.

Automated tests do not prove that a real Cloudflare challenge succeeds in every embedded desktop environment. Real Turnstile, SMTP delivery, OAuth, external synchronization, and model calls need separate checks using configured services.

## Optional experiments

Real experiment scripts run only in Docker, never directly on the host. Prepare the image:

```powershell
docker pull python:3.12-slim
```

The sandbox disables networking, uses a read-only root and workspace, runs as a non-root user, drops capabilities, and limits execution to 1 CPU, 256 MB RAM, 64 processes, 60 seconds, and 1 MB of output. Temporary writes are limited to `/tmp`. Scripts use the Python standard library.

Review code before approving execution. Without Docker, execution is reported as not performed. These are minimal experiments, not full repository reproductions or arbitrary dependency installation environments.

## Verification

```powershell
node scripts/build.mjs
.venv/Scripts/python.exe -m pytest backend/tests -q
node node_modules/@playwright/test/cli.js test
node scripts/verify-package.mjs
node scripts/check-repository.mjs
node scripts/check-locales.mjs
```

Browser tests use isolated data in `.data/e2e-accounts` and ports 5179/8127. Windows tests use installed Chrome when available; otherwise install a browser with `npx playwright install chromium`. Language tests cover live switching, persistence, drafts, login and registration, calendar weekdays, settings, tickets, tab synchronization, and narrow-screen placement.

If test-service cleanup is restricted, start `scripts/dev.mjs` separately with `SAKUYA_PORT=8127`, `VITE_PORT=5179`, and `SAKUYA_DATA_DIR` pointing to `.data/e2e-accounts`, then run Playwright with `SAKUYA_EXTERNAL_TEST_SERVER=1`. Local tests may require `NO_PROXY=127.0.0.1,localhost` and clearing proxy variables for that test process.

Fixed evaluation tasks are in `evals/tasks.jsonl`:

```powershell
.venv/Scripts/python.exe scripts/evaluate.py --mode demo
# Requires configured services and incurs provider charges:
.venv/Scripts/python.exe scripts/evaluate.py --mode live
```

Evaluation records completion, latency, tokens, source counts, and citation-ID validity. These are process metrics, not answer accuracy. Citation support and diagnostic correctness require human review and baseline comparisons.

## Current limitations

- Replies return as complete responses, rather than token streams.
- Model context includes up to 12 recent successful turns of the same mode, with each historical message limited to 4,000 characters.
- Document retrieval uses chunked keyword matching, including Chinese bigrams and English identifiers; there is no embedding or vector database retrieval.
- Repository investigation reads a bounded set of files and may miss the cause. It does not clone and execute full repositories, create patches or pull requests, or send GitHub messages.
- Knowledge-base navigation is currently hidden. Previously saved documents remain available to the backend.
- PostgreSQL deployment, production multi-worker operations, and an internet-facing support service are not provided.

## Project layout

```text
src/                   React UI and English/Chinese localization
electron/              Desktop lifecycle and local service management
backend/app/           API, persistence, authentication, workflows, integrations
backend/tests/         Backend behavior and security boundary tests
tests/                 Browser end-to-end tests
evals/                 Fixed evaluation tasks
scripts/               Setup, development, packaging, verification
docs/                  Design and validation notes
```

Detailed documentation is currently in Chinese: [accounts and models](docs/ACCOUNTS-MODELS.md), [planner integrations](docs/PLANNER.md), [architecture](docs/ARCHITECTURE.md), and [validation history](docs/VALIDATION.md). The [localization guide](docs/LOCALIZATION.md) is available in English.
