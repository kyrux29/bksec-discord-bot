# Hweplir

Hweplir is a Discord bot for managing CTF participation in one server. It is written in TypeScript with discord.js v14 and stores registered CTF data in a local SQLite database (`ctf.db`).

## What the bot does

- Fetches CTF event data from CTFtime.
- Registers a CTF into the Discord server.
- Creates a Discord category, CTF role, info channel, and challenge channels.
- Stores CTF metadata, Discord IDs, archive time, and archive state in SQLite.
- Lists registered CTFs and lets users show or hide CTF channels for themselves.
- Updates login/account information in a CTF info message.
- Archives old CTF categories by hiding them after their configured end time.
- Supports manually-created CTF categories that are not on CTFtime.
- Provides admin utilities for deleting, importing, fixing, and permission-locking CTF categories.
- Provides verification commands for server roles.
- Handles pagination and confirmation buttons for interactive commands.
- Tracks challenge threads, claims, status, solves, points, writeups, and a pinned live dashboard.
- Sends persisted CTF reminders and refreshes countdowns every five minutes.
- Logs bot activity and errors with Winston.

## Commands

### CTFtime commands

| Command | Purpose |
| --- | --- |
| `/ct-info_find` | Search CTFtime by event ID or event name. |
| `/ct-info_ongo` | Show currently ongoing CTFs. |
| `/ct-info_upco` | Show upcoming CTFs with pagination. |
| `/ct-reg` | Register a CTF from a CTFtime event ID. |
| `/ct-regacc` | Update account credentials for a registered CTF. |

### General commands

| Command | Purpose |
| --- | --- |
| `/c-list` | List registered CTFs from the local database. |
| `/c-view` | Toggle access to a registered CTF category by adding/removing its role. |
| `/solve` | Mark the current challenge thread as solved and announce the solved roster. |
| `/whoami` | Show bot information and runtime statistics. |
| `/enroll-htba` | Enroll for access to BKSEC HTB Academy sharing. |

### Admin commands

| Command | Purpose |
| --- | --- |
| `/admin-hide` | Archive expired CTF categories immediately. |
| `/admin-reg_special` | Create a manual CTF category that is not from CTFtime. |
| `/admin-delete` | Delete a CTF record and optionally its Discord objects. |
| `/admin-add` | Add an existing Discord category to the CTF database. |
| `/admin-deny-role` | Deny the configured deny role from viewing existing CTF categories. |
| `/admin-fix` | Fix archived info-channel permissions. |
| `/verifyg10` | Verify a user into G10 by changing roles. |

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
```

Optional environment variables:

```env
LOG_CHANNELID=channel_for_bot_logs
DENY_CTF_ROLEID=role_blocked_from_ctf_categories
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
bun run build   # compile TypeScript to dist/
bun test        # run the CTFtime service test
bun run lint    # lint src/
bun run format  # format src/**/*.ts
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
│   ├── database.service.ts   # SQLite schema and CTF CRUD operations
│   └── discord.service.ts    # Discord roles, channels, categories, events, permissions
├── tests/
│   └── ctftime.test.ts       # Manual test script for CTFtime behavior
├── types/
│   └── index.ts              # Shared TypeScript interfaces and enums
└── utils/
    ├── embed.builder.ts      # Helpers for Discord embeds
    ├── helpers.ts            # Date, formatting, fuzzy search, pagination helpers
    └── logger.ts             # Winston logger setup
```

Other important files:

```text
scripts/migrate-to-sqlite.ts  # Migrates old JSON CTF data into ctf.db
ctf.db                        # Local SQLite database used at runtime
ctf.json                      # Legacy/source JSON data if present
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

The SQLite database has two main tables:

- `metadata`: stores small bot metadata, currently including the CTF counter.
- `ctfs`: stores registered CTFs.

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
