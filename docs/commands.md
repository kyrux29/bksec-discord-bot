# Bot Commands Reference

**Hweplir** — CTF management bot for CLB BKSEC Discord server.

---

## General Commands

Information commands are available to server members. Challenge-management and solve commands require `ACTIVE_CTF_ROLEID` or Discord Administrator permission.

| Command | Description | Options |
|---------|-------------|---------|
| `/whoami` | Display bot info: uptime, memory usage, CTF counts | — |
| `/c-list` | List all CTFs registered in the server | `order` (Mới nhất / Cũ nhất), `page`, `step` |
| `/c-view` | Toggle visibility of a CTF's discussion channels (add/remove role) | `ctf-name` *(role, required)* |
| `/solve` | Mark the current challenge thread as solved and announce the CTF solved list | `members` *(mentions or Discord IDs, required)* |
| `/challenge create` | Create a tracked challenge thread | `name`, `category`, `points` |
| `/challenge claim` | Join the claimant list for the current challenge | — |
| `/challenge release` | Remove yourself from the claimant list | — |
| `/challenge status` | Set working/idea/unclaimed status | `value` |
| `/challenge dashboard` | Create or refresh the pinned CTF dashboard | — |
| `/writeup claim` | Claim the writeup task created after a solve | — |
| `/writeup submit` | Submit the writeup or pull-request URL | `url` |

### `/solve` behavior

- Must be run inside a thread under a registered CTF category.
- Requires `ACTIVE_CTF_ROLEID` (Discord administrators are also accepted).
- Supports an optional `points` override, tracks category first blood, and stores the solve in SQLite.
- Renames the thread with `[SOLVED]`, refreshes the pinned dashboard, and opens a writeup task.
- A five-minute scheduler sends 24h/1h/start/3h-left/1h-left/end reminders and refreshes the countdown dashboard.
- CTF registration creates and pins the dashboard in the CTF-named info channel immediately.
- Completed challenges, completed writeups, and lifecycle reminders are posted to the dedicated `announcements` channel; discussion stays in `general`.
- The dashboard title includes current progress as `solved/total`.
- A member's first message in a challenge thread automatically joins them to its multi-user claimant list. Manually-created threads inside a registered CTF category are registered automatically on that first message.
- Thread names use standardized states: `[OPEN]`, `[ACTIVE]`, `[LEAD]`, and `[SOLVED]`.

### `/c-list` options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `order` | Choice | Mới nhất | Sort order: newest first or oldest first |
| `page` | Integer | 1 | Page number |
| `step` | Integer | 5 | Results per page |

---

## CTFTime Commands

Pull competition info from CTFTime and manage CTF channels in the server.

| Command | Description | Options |
|---------|-------------|---------|
| `/ct-reg` | **Admin:** register a new CTF from CTFTime — creates category, role, channels, dashboard, and scheduled event | `ctftime-id` *(required)* |
| `/ct-regacc` | **Admin:** update shared credentials in the private pinned info message | `username`, `password` *(required)*; `cate_id` *(optional)* |
| `/ct-info_find` | Look up a CTF by CTFTime ID or name | `search-key` *(required)* |
| `/ct-info_ongo` | Show currently ongoing CTFs from CTFTime | — |
| `/ct-info_upco` | Show upcoming CTFs from CTFTime (paginated) | `page`, `step` |

### `/ct-reg` behavior

1. Fetches CTF info from CTFTime API.
2. Creates a Discord category, role, and info channel.
3. Pins a CTF info embed in the info channel.
4. Creates a Discord scheduled event for the competition window.
5. Opens archive-role access when the competition ends and archives the category after a seven-day grace period.
6. Logs the action to the configured log channel.

The command requires `ADMIN_ROLE_ID` or Discord Administrator permission. If registration fails before the database write, partially-created roles and channels are rolled back.

### `/ct-regacc` options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `username` | String | Yes | CTF account username |
| `password` | String | Yes | CTF account password |
| `cate_id` | String | No | Discord Category ID (auto-detected from current channel if omitted) |

The command is admin-only. The password is rendered as a Discord spoiler while the CTF is active and the bot removes the login field before opening post-event access.

### `/ct-info_upco` options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `page` | Integer | 1 | Page number |
| `step` | Integer | 3 | Results per page |

---

## Admin Commands

Restricted to users with the configured admin role or Discord Administrator permission.

| Command | Description | Options |
|---------|-------------|---------|
| `/admin-add` | Manually register an existing Discord category as a CTF in the database | `cate_id` *(optional, auto-detected)* |
| `/admin-delete` | Delete a CTF — prompts to choose between full delete or keep channels | `search_id` *(CTFTime ID or Category ID, required)* |
| `/admin-hide` | Manually archive all CTFs that have passed their end time | — |
| `/admin-deny-role` | Apply `ViewChannel: false` for `DENY_CTF_ROLEID` across all CTF categories | — |
| `/admin-fix` | Rebuild category/channel permissions for live, ended, and archived CTFs | — |
| `/admin-reg_special` | Register a CTF that is not on CTFTime (manual setup) | `name`, `hide_after` *(days, required)* |
| `/admin-unsolve` | Undo an accidental solve in the current challenge thread | — |
| `/verifyg10` | Verify a user into G10: swap guest role for member role | `user` *(required)* |

### `/admin-delete` flow

Shows a confirmation embed with two buttons:
- **Delete all** — removes category, channels, role, and database record.
- **Keep channels** — removes the CTF role and database record, but preserves discussion channels privately for `ACTIVE_CTF_ROLEID` and `VIEW_ALL_CTF_ROLEID`; it never grants access to `@everyone`.

### `/admin-reg_special` options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `name` | String | Yes | CTF name to create |
| `hide_after` | Integer (≥1) | Yes | Days until the category is automatically hidden |

### `/verifyg10` notes

This optional command is registered only when `VERIFY_REMOVE_ROLE_ID`, `VERIFY_GRANT_ROLE_ID`, and `VERIFY_ALLOWED_ROLE_ID` are all configured. No deployment-specific role IDs are stored in source code.

---

## Task Commands *(disabled while the core CTF workflow is being tested)*

These commands are fully implemented but currently disabled until the required environment variables (`ADMIN_ROLE_ID`, `TASK_ADMIN_CHANNEL_ID`, `TASK_ROLE_PWN/REV/CRYPTO/ALL`) are configured.

| Command | Who | Description |
|---------|-----|-------------|
| `/issue-task` | Admin only | Create a new club task with a name, category, and requirement description (via modal) |
| `/submit` | All members | Submit a writeup/solution for an open task (select-menu flow) |
| `/task-status` | Admin only | View all tasks and their submission lists |
| `/show-all` | Admin (all tasks) / Members (revealed tasks only) | Browse task submissions by task |

### Task categories

| Value | Label |
|-------|-------|
| `pwn` | Pwn |
| `rev` | Reversing |
| `crypto` | Crypto |

### Re-enabling task commands

1. Set the required env vars in `.env`:
   ```
   ADMIN_ROLE_ID=
   TASK_ADMIN_CHANNEL_ID=
   TASK_ROLE_PWN=
   TASK_ROLE_REV=
   TASK_ROLE_CRYPTO=
   TASK_ROLE_ALL=
   ```
2. Uncomment the task imports in `src/index.ts`.
3. Uncomment the task entries in the `commands` array in `src/index.ts`.
4. Restore the `isStringSelectMenu` and `isModalSubmit` handlers in `src/index.ts` (fix brace alignment — see note in that file).
5. Restore the required-vars list in `src/config/env.ts`.

---

## Environment Variables Summary

| Variable | Required | Used by |
|----------|----------|---------|
| `BOT_TOKEN` | Yes | Bot login |
| `SERVER_ID` | Yes | Guild command deployment |
| `VERIFIED_ROLE_ID` | No / disabled | HTB enrollment is temporarily disabled |
| `GITHUB_TOKEN` | No / disabled | GitHub integration is temporarily disabled |
| `GH_INVITE_REPO_OWNER` | No / disabled | GitHub integration is temporarily disabled |
| `GH_INVITE_REPO_NAME` | No / disabled | GitHub integration is temporarily disabled |
| `VIEW_ALL_CTF_ROLEID` | Yes | CTF channel visibility |
| `ACTIVE_CTF_ROLEID` | Yes | Live CTF visibility and challenge commands |
| `LOG_CHANNELID` | No | Audit log channel |
| `DENY_CTF_ROLEID` | No | `admin-deny-role` command |
| `ADMIN_ROLE_ID` | Yes | All `/admin-*` commands and destructive confirmation buttons |
| `VERIFY_REMOVE_ROLE_ID` | No | Role removed by optional `/verifyg10` |
| `VERIFY_GRANT_ROLE_ID` | No | Role granted by optional `/verifyg10` |
| `VERIFY_ALLOWED_ROLE_ID` | No | Role allowed to run optional `/verifyg10` |
| `TASK_ADMIN_CHANNEL_ID` | Task only | Task submission notifications |
| `TASK_ROLE_PWN` | Task only | Role granted on pwn task solve |
| `TASK_ROLE_REV` | Task only | Role granted on rev task solve |
| `TASK_ROLE_CRYPTO` | Task only | Role granted on crypto task solve |
| `TASK_ROLE_ALL` | Task only | Role granted when all categories solved |

`ACTIVE_CTF_ROLEID` and `VIEW_ALL_CTF_ROLEID` should be different roles. Using the same role is supported as a compatibility mode, but disables phase-specific visibility. A conflicting `DENY_CTF_ROLEID` is ignored with a startup warning.
