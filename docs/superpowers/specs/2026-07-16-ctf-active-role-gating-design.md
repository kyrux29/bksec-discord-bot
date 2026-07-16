# CTF Category Active-Role Gating — Design

Date: 2026-07-16

## Goal

CTF categories must be visible to **only** the active role (`1527199927447453756`)
while the CTF is running. When a CTF's time runs out, its category reverts to the
previous behavior (per-CTF role + VIEW_ALL role can view). This applies to all
existing categories and all future ones, created via either creation path.

## Background (current behavior)

- The guild `@everyone` role **HAS** View Channel in its base permissions (verified
  against the live guild: bitfield `2248473465835072`). Categories are therefore
  visible to everyone **unless `@everyone` is explicitly denied** on the category.
  Role allow-overwrites alone hide nothing. This is how `archiveCTFCategory` actually
  hides a category, and 27 of 28 existing categories are hidden exactly this way.
- `createCTFCategory` (`reg`, from CTFtime) and `createSpecialCTFCategory`
  (`reg-special`, manual) currently grant category `ViewChannel` to the **per-CTF role**
  and the **VIEW_ALL** role, plus a `ViewChannel: false` deny for `DENY_CTF_ROLEID`.
- Challenge channels are created without their own View overwrite, so they inherit the
  category's visibility. Only category-level overwrites need to be managed.
- There is **no** background scheduler acting on `endtime`. The only `setInterval`
  (`ready.ts`) rotates the bot status. Archiving/unlisting is manual via commands.
- `endtime` is stored in `ctfs` as epoch **seconds**. `getAllCTFs()` returns
  `{ key, data }` entries where `data` is `CTFData` (`role`, `cate`, `channel`,
  `endtime`, `archived`, `channelsPurged`).

## Permission model

Category-level overwrites in each phase (live = `now < endtime`):

| Role                              | Live (running)      | Ended (`now >= endtime`) |
| --------------------------------- | ------------------- | ------------------------ |
| `@everyone`                       | ❌ **deny**         | ❌ **deny** (stays)      |
| Active role `1527199927447453756` | ✅ ViewChannel      | ✅ ViewChannel (kept)    |
| Per-CTF role                      | ➖ not granted      | ✅ ViewChannel           |
| VIEW_ALL role                     | ➖ not granted      | ✅ ViewChannel           |
| DENY_CTF role                     | ❌ deny (kept)      | ❌ deny (kept)           |

Denying `@everyone` is what actually hides the category — without it, the base
permission makes it visible to the whole server regardless of role grants. `@everyone`
stays denied in **both** phases so access is always role-gated; the phases differ only
in which roles are granted. This matches the state of the 27 existing archived
categories (`@everyone` denied + per-CTF + VIEW_ALL granted).

The active-role grant is **kept** on revert (the existing grant-role command can still
let a specific user view a specific ended CTF). The live→ended transition is therefore
**additive**: it adds the per-CTF and VIEW_ALL grants and removes nothing.

## Components

### 1. Config
Add `ACTIVE_CTF_ROLEID` to `.env`, `.env.example`, and `config/env.ts`
(required var, value `1527199927447453756`).

### 2. Service helpers (`discord.service.ts`)
- `applyLivePermissions(guild, categoryId)` — set category overwrites for the live
  phase: active role `ViewChannel: true`; DENY role `ViewChannel: false` (if set).
  Does not grant per-CTF / VIEW_ALL.
- `applyEndedPermissions(guild, categoryId, perCtfRoleId)` — add per-CTF role and
  VIEW_ALL `ViewChannel: true` (active-role and deny overwrites untouched).
- `syncEndedCTFs(guild)` — sweep: for every CTF in the DB that has a category and is
  not archived and not purged, if `now >= endtime` and `post_end_opened === 0`, call
  `applyEndedPermissions` and set `post_end_opened = 1`. Returns the count reverted.

### 3. Create flow
Both `createCTFCategory` and `createSpecialCTFCategory` call `applyLivePermissions`
on the new category instead of granting per-CTF + VIEW_ALL.

### 4. Sweep hooks
- After a successful create in `reg` and `reg-special`, call `syncEndedCTFs(guild)`.
- Extend `/admin-fix` to call `syncEndedCTFs(guild)` and include the reverted count in
  its reply. (Existing archived-info-channel fix is retained.)

### 5. DB migration (`database.service.ts`)
Add column `post_end_opened INTEGER NOT NULL DEFAULT 0` using the same
try/`ALTER TABLE`/catch pattern as `channels_purged`. Expose it via `updateCTF` and the
row→`CTFData` mapping so the sweep can set it. New CTFs default to `0` (live).

### 6. One-off fix script (`scripts/fix-ctf-visibility.ts`)
Bring existing categories into the new model. For each CTF with an existing category
(skip `channelsPurged` and `archived`):
- live (`now < endtime`)  → `applyLivePermissions`, set `post_end_opened = 0`
- ended (`now >= endtime`) → `applyEndedPermissions`, set `post_end_opened = 1`

Dry-run by default; `--apply` performs changes. Follows the existing script conventions
(`import 'dotenv/config'`, REST-based, token validation, tagged console output).

## Edge cases
- **Archived / purged CTFs** are skipped by the sweep and the fix script (archived means
  intentionally hidden; purged has no category).
- **Missing category** (deleted out of band): skip and log.
- **post_end_opened** guards against repeatedly re-applying ended permissions; the sweep
  only acts on the one-time live→ended transition.
- **Idempotent overwrites:** `permissionOverwrites.create/edit` upserts, so re-runs are safe.

## Out of scope
- No background scheduler/timer (revert is opportunistic on create + `/admin-fix`).
- No change to how the per-CTF role or active role is assigned to members.
- No change to archive/unlist/purge flows beyond being skipped by the sweep.
