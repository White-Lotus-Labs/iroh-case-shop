# Development notes

This page is for people who change the code. For what the app does, read [How the tea shop works](how-it-works.md). To run the app for the first time, follow [Run it locally](../README.md#run-it-locally) in the README.

## Set up

1. Use Node.js 24.10.0, the version in `.nvmrc` and on Railway. The app runs on 22.12 or newer, but the unit tests need 22.13 or newer, because they use `node:sqlite`. With nvm on macOS or Linux, run `nvm use`. With nvm-windows, run `nvm install 24.10.0`, then `nvm use 24.10.0`.
2. Run `npm ci`. It also runs `prisma generate` (the `postinstall` script).
3. Copy `.env.example` to `.env.local`. Git ignores every `.env*` file except `.env.example`.
4. Run `npm run dev`. It first runs `npm run db:migrate`, which creates `prisma/dev.db` and applies the migrations.

`npm run build` needs network access, because Next.js downloads the fonts (Cormorant Garamond and Inter) from Google Fonts. `npm run dev` also works offline. It then logs an error and uses fallback fonts.

`npm run dev` listens on 127.0.0.1. If port 3000 is busy, Next.js takes the next free port and prints it. To choose the port, run `npm run dev -- --port 3101`.

### Work without spending Nansen credits

Every server process runs the background save when it starts. That includes:

- `npm run dev` and `npm start`
- the dev server that the browser tests start
- the server that `scripts/perf-audit.mjs` starts
- the server on Railway

With `NANSEN_API_KEY` set, each of these processes spends credits on readings that are due. A new checkout with an empty database makes up to 103 requests at the first start.

To spend nothing, leave `NANSEN_API_KEY` empty in `.env.local`. Also check that your shell does not set it, because a shell value wins over `.env.local`. In bash or zsh (macOS, Linux, Git Bash), you can empty the key for one run:

```sh
NANSEN_API_KEY= npm run dev
```

PowerShell has no such one-run form. In Windows PowerShell 5.1, `$env:NANSEN_API_KEY = ''` deletes the variable, so Next.js reads the key from `.env.local` again. In PowerShell, empty the key in `.env.local` instead.

## Settings

The app reads each variable from the shell, then `.env.local`, then `.env`. The first value it finds wins, even an empty one.

| Variable                   | Default         | What it does                                                                                                                 |
| -------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`             | none in the app | The SQLite file. Use `file:./dev.db` locally (the path is relative to `prisma/`). The app fails without it.                  |
| `NANSEN_API_KEY`           | empty           | The house key. It pays for the background save and for free Uncle messages. It never goes to the browser.                    |
| `NANSEN_AGENT_DAILY_LIMIT` | `1`             | Free house-key Uncle messages per IP address (IPv6: per /64) per UTC day. `0` turns them off. A bad value falls back to `1`. |
| `TRIPO_API_KEY`            | empty           | Used only by `scripts/tripo.mjs`. That script reads `.env.local` only, not `.env`.                                           |

Ten more variables set how the server paces its Nansen calls. [Nansen request queue](nansen-request-manager.md) lists them.

Keep `DATABASE_URL` as `file:./dev.db`. `npm run db:migrate` does not read `.env.local`. It reads `DATABASE_URL` from the shell, or uses `file:./dev.db`. If you change the path in `.env.local` only, the app opens a file that was never migrated. To use another path, set it in the shell too.

Test and script variables:

| Variable              | Default                 | Used by                                                                |
| --------------------- | ----------------------- | ---------------------------------------------------------------------- |
| `PLAYWRIGHT_BASE_URL` | `http://127.0.0.1:3000` | Browser tests                                                          |
| `SMOKE_BASE`          | `http://127.0.0.1:3102` | `scripts/nansen-smoke.mjs`                                             |
| `PERF_AUDIT_EXTERNAL` | unset                   | `scripts/perf-audit.mjs`: set to `1` to use a server that already runs |

`NODE_ENV=production` makes the session cookie `Secure` and turns off the dev-only URL options below.

## npm scripts

| Command                | What it does                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `npm run dev`          | Migrates the database, then starts Next.js in development mode on 127.0.0.1             |
| `npm run build`        | Builds for production. The background save does not run during a build.                 |
| `npm start`            | Starts the production build on 127.0.0.1. It does not migrate the database.             |
| `npm run db:migrate`   | Creates the SQLite file if it is missing, then runs `prisma migrate deploy`             |
| `npm run typecheck`    | Generates route types and runs `tsc --noEmit`                                           |
| `npm test`             | Runs the unit tests with Vitest                                                         |
| `npm run test:e2e`     | Runs the browser tests with Playwright                                                  |
| `npm run format`       | Formats `src`, `tests`, the root `.ts` and `.json` files, and `README.md` with Prettier |
| `npm run format:check` | Checks the same files. The files in `docs/` and `scripts/` are not checked.             |

## Database

The database is one SQLite file with five tables: `User`, `Session`, `Chat`, `Message`, and `NansenSnapshot`. The schema is `prisma/schema.prisma`. The migrations are in `prisma/migrations/`.

The Prisma CLI reads `.env`, not `.env.local`. Give it the URL when you run it. In bash: `DATABASE_URL=file:./dev.db npx prisma studio`. In PowerShell: `$env:DATABASE_URL = 'file:./dev.db'; npx prisma studio`.

The database tests do not run `prisma migrate`. `openTempDb()` in `tests/temp-sqlite.ts` makes a temporary SQLite file and applies every `prisma/migrations/*/migration.sql` in folder-name order. A new migration is picked up with no test changes.

## Tests

### Unit tests

`npm test` runs every `tests/*.test.ts` file. The tests replace `fetch` with fakes and use recorded Nansen answers from `tests/fixtures/nansen/`. They never call Nansen. Database tests make a temporary SQLite file.

One unit test reads `README.md`. It fails unless the README still contains the text `103 Nansen requests`, `57 Nansen requests`, `agent/fast`, and `.env.local`. Keep those words when you edit the README.

### Browser tests

`npm run test:e2e` runs the Playwright specs in `tests/browser/`, one at a time, in headless Chromium.

- Run `npx playwright install chromium` once before the first run.
- Playwright uses the server at `PLAYWRIGHT_BASE_URL`. If nothing answers there, it starts `npm run dev` on that port.
- Use a dev server, not `npm start`. Some specs need the dev-only camera hook `window.__teaCamera`.
- Most specs fake the app's own API answers. The dev server still runs the real background save, so a key in `.env.local` can spend Nansen credits during a test run.
- The tests create real accounts, with nicknames such as `Test_…`, in the database of the server under test.

### CI

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`. It runs `npm run format:check`, `npm run typecheck`, `npm test`, and `npm run build`, with `NANSEN_API_KEY` empty. It does not run the browser tests, because they need a GPU.

## Scripts

| Script                         | What it does                                                                                                                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/readme-shots.mjs`     | Takes the README screenshots at 1440×900 and saves them as WebP in `docs/screenshots/`. It uses the live site by default. It opens the Host panel but never sends a message.                                   |
| `scripts/visual-shots.mjs`     | Takes fixed art-review shots of the 3D room from a dev server. See [Visual rubric](visual-rubric.md).                                                                                                          |
| `scripts/perf-audit.mjs`       | Measures load time and page weight on desktop and mobile. Run `npm run build` first. It writes `docs/perf-runs/latest.json` and prints a table.                                                                |
| `scripts/nansen-smoke.mjs`     | Reads the saved thesis books and the 12 asset pages from the server at `SMOKE_BASE` (default port 3102, not 3000). It fails on any server error. It does not call Nansen.                                      |
| `scripts/tripo.mjs`            | Sends an image to Tripo and saves the 3D model it returns. It costs Tripo credits.                                                                                                                             |
| `scripts/host-model/build.mjs` | Rigs a Tripo model of Uncle with Blender. It deletes the old `public/models/iroh-host*` files and writes two new ones, at 2048 and 1024 texture sizes. Paste the printed names into `src/scene/IrohModel.tsx`. |
| `scripts/migrate-db.mjs`       | The database setup behind `npm run db:migrate` and the Railway start command                                                                                                                                   |
| `scripts/generate-prisma.mjs`  | Runs `prisma generate` after `npm ci`                                                                                                                                                                          |

To retake the README screenshots, install Playwright's Chromium once with `npx playwright install chromium`. Then run:

```sh
node scripts/readme-shots.mjs
```

Add `--base=http://127.0.0.1:3000` to use a local server, and `--only=host,shelf` to take some shots only. A local server needs saved readings first, or the panels show "still being saved".

## Dev-only URL options

These work only in development mode:

- `?shot=<name>` locks the camera to a fixed art-review pose. `scripts/visual-shots.mjs` uses it.
- `?irohPose=<action>:<seconds>` holds one frame of Uncle's animation. The actions are `rest`, `sip`, `pour`, `nod`, and `shake`.

This works everywhere: `?thesis=robinhood`, `?thesis=bullrun`, or `?thesis=ai` skips the waiting room and opens that thesis.

## Names in the code

The code uses a few older names:

| In the code      | In the app                                       |
| ---------------- | ------------------------------------------------ |
| `Iroh`, `iroh`   | Uncle                                            |
| `Entrance`       | Waiting room                                     |
| `AvatarSeat`     | Host                                             |
| `TeaTable`       | Observatorium                                    |
| `tea-after-pour` | The npm package name; the app is Iroh's Tea Shop |

## API routes

| Route                                        | What it returns                                                                                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/theses`                            | The saved thesis books                                                                                                                                                                                                         |
| `GET /api/theses/{thesisId}/{symbol}`        | One saved asset page, for example `/api/theses/bullrun/HYPE`                                                                                                                                                                   |
| `GET /api/smart-wallet-leaderboard`          | One saved Shelf board. Query: `board` = `perps`, `smart-money`, `whales`, or `meme`; `metric` = `wins`, `losses`, `roi`, `account`, `holdings`, or `positions`. `meme` takes only `wins` and `roi`. Defaults: `perps`, `wins`. |
| `GET /api/nansen-status`                     | Whether the server has a house key                                                                                                                                                                                             |
| `POST /api/nansen-agent`                     | One Uncle message, streamed back as server-sent events                                                                                                                                                                         |
| `GET`, `POST /api/iroh/chats`                | List or create the logged-in visitor's chats                                                                                                                                                                                   |
| `GET /api/iroh/chats/{chatId}`               | One saved chat with its messages                                                                                                                                                                                               |
| `POST /api/auth/register`, `login`, `logout` | Accounts                                                                                                                                                                                                                       |
| `GET /api/auth/me`                           | The current user                                                                                                                                                                                                               |

The saved-reading routes never call Nansen. When nothing is saved yet, they answer `503` with the text that the panels show.

The `POST` routes refuse a request that the browser marks as coming from another site (`Sec-Fetch-Site`). `register`, `login`, and `nansen-agent` also refuse a body that is not `application/json`.

## Deploy

The site runs on Railway:

- One service, `web`, with one replica. Keep it at one: see the limits in [How the tea shop works](how-it-works.md#known-limits).
- A GitHub trigger deploys each push to `main`. The trigger lives in the Railway settings, so check that a deploy started after you push.
- CI (see [CI](#ci)) checks pull requests, but Railway does not wait for it. A push to `main` deploys even when CI fails, so merge only green pull requests.
- Railway builds with Railpack and has no custom build command. The repo has no Railway config file.
- The start command lives in the Railway settings, not in the repo:

  ```sh
  node scripts/migrate-db.mjs && npx next start --hostname 0.0.0.0 --port ${PORT:-3000}
  ```

- `DATABASE_URL=file:/data/dev.db`, on the volume `app-data` mounted at `/data`.
- The Railway project also has a service named `SQLite3`. The app does not use it.

Some files in `public/images`, `public/audio`, and `public/models` have a 6-character content hash in the name, such as `tea-back-wall.bbdb12.webp`. The server tells browsers to cache these files for a year. When you change such a file, change the hash in its name.
