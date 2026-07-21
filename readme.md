# Hweplir

Hweplir is a Discord bot for managing CTF participation in one server. It is written in TypeScript with discord.js v14 and stores registered CTF data in a local SQLite database (`ctf.db`).

## What the bot does

- Fetches CTF event data from CTFtime.
- Registers a CTF into the Discord server.
- Creates a Discord category, CTF role, info channel, and challenge channels.
- Stores CTF metadata, Discord IDs, archive time, and archive state in SQLite.
- Lists registered CTFs and lets users show or hide CTF channels for themselves.
- Lets administrators update shared login information; passwords use Discord spoilers and are removed automatically when the competition ends.
- Opens archive-role access at competition end and archives CTFtime categories after a seven-day grace period.
- Supports manually-created CTF categories that are not on CTFtime.
- Provides admin utilities for deleting, importing, fixing, and permission-locking CTF categories.
- Can optionally provide a configurable server-role verification command.
- Handles pagination and confirmation buttons for interactive commands.
- Tracks challenge threads, claims, status, solves, points, writeups, and a pinned live dashboard.
- Sends persisted CTF reminders and refreshes countdowns every five minutes.
- Logs bot activity and errors with Winston.

## Commands

Slash commands are deployed to the guild configured by `SERVER_ID` whenever the bot starts.
In the tables below, `<value>` is required and `[value]` is optional. See
[`docs/commands.md`](docs/commands.md) for detailed behavior and examples.

### CTFtime commands

| Command | Access | Purpose |
| --- | --- | --- |
| `/ct-info_find <search-key>` | Member | Search CTFtime by event ID or event name. |
| `/ct-info_ongo` | Member | Show currently ongoing CTFs. |
| `/ct-info_upco [page] [step]` | Member | Show upcoming CTFs with pagination. |
| `/ct-reg <ctftime-id>` | Admin | Register a CTF from CTFtime and create its Discord resources. |
| `/ct-regacc <username> <password> [cate_id]` | Admin | Update shared credentials in the private CTF information message. |

`/ct-reg` and `/ct-regacc` require `ADMIN_ROLE_ID` or Discord Administrator permission.

### General commands

| Command | Access | Purpose |
| --- | --- | --- |
| `/whoami` | Member | Show bot information, uptime, memory usage, and CTF counts. |
| `/c-list [order] [page] [step]` | Member | List registered CTFs from the local database. |
| `/c-view <ctf-name>` | Member | Toggle a registered CTF role to show or hide its channels. |

### Challenge commands

Challenge-management commands must be used in a registered CTF category. Except for writeup commands, they require `ACTIVE_CTF_ROLEID` or Discord Administrator permission.

| Command | Where | Purpose |
| --- | --- | --- |
| `/challenge create <name> <category> [points]` | Matching `web`, `crypto`, `pwn`, `rev`, `forensics`, or `misc` channel | Create a tracked challenge thread. |
| `/challenge claim` | Challenge thread | Add yourself to the claimant list. |
| `/challenge release` | Challenge thread | Remove yourself from the claimant list. |
| `/challenge status <value>` | Challenge thread | Set the state to `working`, `idea`, or `unclaimed`. |
| `/challenge dashboard` | Registered CTF category or challenge thread | Create or refresh the pinned progress dashboard. |
| `/solve <members> [points]` | Challenge thread | Mark the challenge solved, store the solver list, rename the thread, refresh the dashboard, and announce the solve. |
| `/writeup claim` | Solved challenge thread | Claim responsibility for the challenge writeup. |
| `/writeup submit <url>` | Solved challenge thread | Submit an HTTP(S) writeup or pull-request URL; only the claimant can submit it. |

Sending your first message in an unsolved challenge thread automatically claims it. Multiple members may claim the same challenge.

### Admin commands

These commands require `ADMIN_ROLE_ID` or Discord Administrator permission unless noted otherwise.

| Command | Purpose |
| --- | --- |
| `/admin-hide` | Immediately process and archive CTF categories that have passed their archive time. |
| `/admin-reg_special <name> <hide_after>` | Register a manual CTF that is not listed on CTFtime. |
| `/admin-delete <search_id>` | Find a CTF by CTFtime/category ID and choose whether to delete everything or keep its channels. |
| `/admin-add [cate_id]` | Import an existing Discord category into the CTF database; the current category is used when omitted. |
| `/admin-deny-role` | Apply the configured `DENY_CTF_ROLEID` to all tracked CTF categories. |
| `/admin-fix` | Rebuild lifecycle permissions for live, ended, and archived CTF categories. |
| `/admin-unsolve` | Undo an accidental solve in the current challenge thread. |
| `/verifyg10 <user>` | Optional verifier-role command that swaps the configured guest/member roles. |

`/verifyg10` is registered only when `VERIFY_REMOVE_ROLE_ID`, `VERIFY_GRANT_ROLE_ID`, and `VERIFY_ALLOWED_ROLE_ID` are all configured. It uses `VERIFY_ALLOWED_ROLE_ID` instead of `ADMIN_ROLE_ID` for authorization.

### Disabled club-task commands

The older training-task workflow is not currently registered, so `/issue-task`, `/submit`, `/task-status`, and `/show-all` will not appear in Discord. Its `TASK_ROLE_PWN`, `TASK_ROLE_REV`, `TASK_ROLE_CRYPTO`, and `TASK_ROLE_ALL` variables are not required for the core CTF workflow.

## Runtime requirements

- Bun
- Dependencies from `package.json`
- A Discord bot token
- A Discord server where the bot can manage slash commands, roles, channels, and scheduled events

Required environment variables:

```env
SERVER_ID=discord_guild_id
BOT_TOKEN=discord_bot_token
VIEW_ALL_CTF_ROLEID=role_that_can_view_all_ctfs
ACTIVE_CTF_ROLEID=role_for_current_ctf_players
ADMIN_ROLE_ID=role_allowed_to_manage_ctfs
```

Optional environment variables:

```env
LOG_CHANNELID=channel_for_bot_logs
DENY_CTF_ROLEID=role_blocked_from_ctf_categories
VERIFY_REMOVE_ROLE_ID=optional_guest_role
VERIFY_GRANT_ROLE_ID=optional_member_role
VERIFY_ALLOWED_ROLE_ID=optional_verifier_role
VERIFIED_ROLE_ID=only_needed_when_htb_enrollment_is_re-enabled
GITHUB_TOKEN=only_needed_when_github_invites_are_re-enabled
GH_INVITE_REPO_OWNER=only_needed_when_github_invites_are_re-enabled
GH_INVITE_REPO_NAME=only_needed_when_github_invites_are_re-enabled
```

## Run the bot

```bash
bun install
bun run build
bun start
```

Development mode:

```bash
bun run dev
```

Useful scripts:

```bash
bun run check       # formatting, lint, build, and deterministic tests
bun run audit       # scan direct and transitive dependencies
bun run test        # deterministic local tests (no network)
bun run test:smoke  # optional live CTFtime API smoke test
bun run lint        # lint src/ with zero warnings allowed
bun run format      # format TypeScript and root JSON files
```

## Code structure

```text
src/
├── index.ts                  # Creates the Discord client, registers commands, routes interactions
├── commands/
│   ├── ctftime/              # Commands backed by CTFtime data
│   ├── general/              # User-facing server commands
│   └── admin/                # Admin-only maintenance commands
├── components/
│   └── buttons.ts            # Button interaction handlers for pagination and confirmations
├── config/
│   └── env.ts                # Environment loading and validation
├── data/
│   └── statuses.ts           # Bot status messages
├── events/
│   └── ready.ts              # Startup behavior and ready-state handling
├── services/
│   ├── ctftime.service.ts    # CTFtime API access, event parsing, search, pagination embeds
│   ├── challenge.service.ts  # Dashboards, announcements, and thread naming
│   ├── ctf-scheduler.service.ts # Lifecycle reminders and permission sweeps
│   ├── database.service.ts   # SQLite schema and persistent state
│   └── discord.service.ts    # Discord roles, channels, categories, events, permissions
├── tests/
│   ├── challenge-database.test.ts
│   ├── ctf-schedule.test.ts
│   └── ctftime.test.ts       # Optional live CTFtime smoke test
├── types/
│   └── index.ts              # Shared TypeScript interfaces and enums
└── utils/
    ├── embed.builder.ts      # Helpers for Discord embeds
    ├── helpers.ts            # Date, formatting, fuzzy search, pagination helpers
    └── logger.ts             # Winston logger setup
```

Other important files:

```text
ctf.db                        # Local SQLite database used at runtime
logs/                         # Runtime log files
```

## Main flow

1. `src/index.ts` loads config, creates the Discord client, imports all commands, and registers slash commands for `SERVER_ID`.
2. A slash command interaction is routed to the matching command object from the command collection.
3. CTFtime commands use `ctftime.service.ts` to fetch and format CTFtime event data.
4. Registration commands use `discord.service.ts` to create roles, categories, channels, and scheduled events.
5. Registration state is saved through `database.service.ts` into `ctf.db`.
6. Button interactions are handled by `components/buttons.ts` for pagination and delete confirmations.
7. Logs are written through `utils/logger.ts`.

## Database model

The SQLite database stores CTFs, challenge state, dashboards, reminders, solved records, and the currently-disabled club-task workflow.

- `metadata`: stores small bot metadata, currently including the CTF counter.
- `ctfs`: stores registered CTFs and separate competition/archive times.
- `ctf_challenges`, `solved_challenges`: challenge ownership and solve state.
- `ctf_dashboards`, `ctf_reminders`: persistent dashboard and scheduler state.

Each CTF row stores:

- CTFtime ID
- Discord role ID
- Discord category ID
- CTF display name
- info message ID
- main/info channel ID
- archive timestamp
- archive state
- created/updated timestamps

## Notes for code readers

- Commands follow the shared `Command` interface in `src/types/index.ts`: each command exports `data` and `execute`.
- `src/index.ts` is the command registry. If a command is not imported and added there, Discord will not receive it.
- `ctftime.service.ts` is responsible for remote CTFtime data and embed content.
- `discord.service.ts` is responsible for Discord side effects.
- `database.service.ts` is responsible for persistent local state.
- `components/buttons.ts` must understand any custom button IDs created by commands or embed builders.
- Generated JavaScript and declaration files are written to `dist/` by `bun run build`.
