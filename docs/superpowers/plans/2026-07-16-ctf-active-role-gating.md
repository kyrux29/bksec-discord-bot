# CTF Category Active-Role Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make live CTF categories visible to the active role only, and revert them to per-CTF + VIEW_ALL when their time runs out.

**Architecture:** Category visibility is set at creation to a "live" state (active role only). A DB flag `post_end_opened` tracks the one-time live→ended flip. An opportunistic sweep (`syncEndedCTFs`) runs on new-CTF creation and via `/admin-fix`, granting per-CTF + VIEW_ALL to any CTF whose `endtime` has passed. A one-off REST script migrates existing categories.

**Tech Stack:** TypeScript, discord.js v14, better-sqlite3, tsx. Verification uses `npm run build` (tsc) + the existing tsx test runner + the fix script's dry-run against the live guild.

## Global Constraints

- Active role id: `1527199927447453756` (config var `ACTIVE_CTF_ROLEID`).
- `@everyone` has no base View Channel — visibility is granted only via category role overwrites; "not granted" = invisible.
- Permission model: **live** = active role View (+ DENY_CTF deny); **ended** = additionally grant per-CTF role View + VIEW_ALL role View. Active-role grant is **kept** on revert (never stripped).
- `endtime` is epoch **seconds**; `now = Math.floor(Date.now() / 1000)`; live = `now < endtime`.
- The sweep skips CTFs that are `archived`, `channelsPurged`, or have no `cate`.
- Follow existing script conventions for the one-off script: `import 'dotenv/config'`, REST-based, validate token, dry-run by default with `--apply`, tagged console output.

---

### Task 1: Config — add ACTIVE_CTF_ROLEID

**Files:**
- Modify: `src/types/index.ts` (EnvConfig interface)
- Modify: `src/config/env.ts` (required var list + return object)
- Modify: `.env`
- Modify: `.env.example`

**Interfaces:**
- Produces: `config.ACTIVE_CTF_ROLEID: string`

- [ ] **Step 1: Add the field to EnvConfig**

In `src/types/index.ts`, inside `interface EnvConfig`, add after `VIEW_ALL_CTF_ROLEID: string;`:

```typescript
  ACTIVE_CTF_ROLEID: string;
```

- [ ] **Step 2: Require and export it**

In `src/config/env.ts`, add `'ACTIVE_CTF_ROLEID',` to the `requiredVars` array (after `'VIEW_ALL_CTF_ROLEID',`), and in the returned object add after `VIEW_ALL_CTF_ROLEID: process.env.VIEW_ALL_CTF_ROLEID!,`:

```typescript
    ACTIVE_CTF_ROLEID: process.env.ACTIVE_CTF_ROLEID!,
```

- [ ] **Step 3: Add to env files**

Append to `.env`:

```
ACTIVE_CTF_ROLEID=1527199927447453756
```

Append to `.env.example` (under the VIEW_ALL line):

```
ACTIVE_CTF_ROLEID=1000000000000000600
# ACTIVE_CTF_ROLEID: role required to view a CTF while it is running
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: PASS (no TypeScript errors).

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/config/env.ts .env.example
git commit -m "feat: add ACTIVE_CTF_ROLEID config"
```

(Note: `.env` is gitignored; it is intentionally not staged.)

---

### Task 2: DB column `post_end_opened`

**Files:**
- Modify: `src/types/index.ts` (CTFData interface)
- Modify: `src/services/database.service.ts` (migration, rowToCTFData, updateCTF)

**Interfaces:**
- Produces: `CTFData.postEndOpened: boolean`; `updateCTF(key, { postEndOpened })` persists `post_end_opened`.

- [ ] **Step 1: Add field to CTFData**

In `src/types/index.ts`, inside `interface CTFData`, add after `channelsPurged: boolean;`:

```typescript
  postEndOpened: boolean;
```

- [ ] **Step 2: Add the migration**

In `src/services/database.service.ts`, directly after the existing `channels_purged` migration block:

```typescript
      // Migrate: add channels_purged column if not present
      try {
        this.db.exec('ALTER TABLE ctfs ADD COLUMN channels_purged INTEGER NOT NULL DEFAULT 0');
      } catch {
        // column already exists
      }
```

add:

```typescript
      // Migrate: add post_end_opened column if not present
      try {
        this.db.exec('ALTER TABLE ctfs ADD COLUMN post_end_opened INTEGER NOT NULL DEFAULT 0');
      } catch {
        // column already exists
      }
```

- [ ] **Step 3: Map the column in rowToCTFData**

In `rowToCTFData`, add after `channelsPurged: row.channels_purged === 1,`:

```typescript
      postEndOpened: row.post_end_opened === 1,
```

- [ ] **Step 4: Handle it in updateCTF**

In `updateCTF`, after the `channelsPurged` block:

```typescript
      if (updates.channelsPurged !== undefined) {
        setClauses.push('channels_purged = ?');
        values.push(updates.channelsPurged ? 1 : 0);
      }
```

add:

```typescript
      if (updates.postEndOpened !== undefined) {
        setClauses.push('post_end_opened = ?');
        values.push(updates.postEndOpened ? 1 : 0);
      }
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/services/database.service.ts
git commit -m "feat: add post_end_opened column to ctfs"
```

---

### Task 3: Phase helper + unit test

**Files:**
- Create: `src/utils/ctf-visibility.ts`
- Create: `src/tests/ctf-visibility.test.ts`
- Modify: `src/tests/run-tests.ts` (default test list)

**Interfaces:**
- Produces: `isCtfLive(endtimeSeconds: number, nowSeconds: number): boolean` — `true` when `nowSeconds < endtimeSeconds`.

- [ ] **Step 1: Write the failing test**

Create `src/tests/ctf-visibility.test.ts`:

```typescript
import { isCtfLive } from '../utils/ctf-visibility';

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`❌ ${msg}`);
    throw new Error(msg);
  }
  console.log(`✅ ${msg}`);
}

const now = 1_000_000;
assert(isCtfLive(now + 100, now) === true, 'future endtime => live');
assert(isCtfLive(now - 100, now) === false, 'past endtime => ended');
assert(isCtfLive(now, now) === false, 'endtime == now => ended');

console.log('ctf-visibility tests passed');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx src/tests/ctf-visibility.test.ts`
Expected: FAIL — `Cannot find module '../utils/ctf-visibility'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/utils/ctf-visibility.ts`:

```typescript
/**
 * A CTF is "live" while the current time is before its end time.
 * @param endtimeSeconds CTF end time in epoch seconds
 * @param nowSeconds current time in epoch seconds
 */
export function isCtfLive(endtimeSeconds: number, nowSeconds: number): boolean {
  return nowSeconds < endtimeSeconds;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx src/tests/ctf-visibility.test.ts`
Expected: PASS — prints "ctf-visibility tests passed".

- [ ] **Step 5: Register the test in the runner**

In `src/tests/run-tests.ts`, change the default list to include the new file:

```typescript
    : ['src/tests/ctftime.test.ts', 'src/tests/task-database.test.ts', 'src/tests/ctf-visibility.test.ts'];
```

- [ ] **Step 6: Commit**

```bash
git add src/utils/ctf-visibility.ts src/tests/ctf-visibility.test.ts src/tests/run-tests.ts
git commit -m "feat: add isCtfLive phase helper with test"
```

---

### Task 4: Service permission helpers + sweep

**Files:**
- Modify: `src/services/discord.service.ts`

**Interfaces:**
- Consumes: `config.ACTIVE_CTF_ROLEID`, `config.VIEW_ALL_CTF_ROLEID`, `config.DENY_CTF_ROLEID`; `isCtfLive`; `databaseService.getAllCTFs()`, `databaseService.updateCTF()`.
- Produces:
  - `applyLivePermissions(guild: Guild, categoryId: string, perCtfRoleId: string): Promise<void>`
  - `applyEndedPermissions(guild: Guild, categoryId: string, perCtfRoleId: string): Promise<void>`
  - `syncEndedCTFs(guild: Guild): Promise<number>` — returns count reverted.

- [ ] **Step 1: Add imports**

At the top of `src/services/discord.service.ts`, after `import { config } from '../config/env';`:

```typescript
import databaseService from './database.service';
import { isCtfLive } from '../utils/ctf-visibility';
```

- [ ] **Step 2: Add the three methods**

Add these methods inside the `DiscordService` class (e.g. just before `createCTFEvent`):

```typescript
  /**
   * Live-phase category visibility: active role only (plus DENY deny).
   * Removes any per-CTF / VIEW_ALL grants so only active-role members can see it.
   */
  async applyLivePermissions(
    guild: Guild,
    categoryId: string,
    perCtfRoleId: string
  ): Promise<void> {
    const category = guild.channels.cache.get(categoryId) as CategoryChannel | undefined;
    if (!category) {
      logger.warn(`applyLivePermissions: category not found: ${categoryId}`);
      return;
    }

    await category.permissionOverwrites.edit(config.ACTIVE_CTF_ROLEID, { ViewChannel: true });

    if (config.DENY_CTF_ROLEID) {
      await category.permissionOverwrites.edit(config.DENY_CTF_ROLEID, { ViewChannel: false });
    }

    // Ensure the per-CTF role and VIEW_ALL role cannot see it while live.
    for (const roleId of [perCtfRoleId, config.VIEW_ALL_CTF_ROLEID]) {
      if (roleId && category.permissionOverwrites.cache.has(roleId)) {
        await category.permissionOverwrites.delete(roleId);
      }
    }
  }

  /**
   * Ended-phase category visibility: additionally grant per-CTF role + VIEW_ALL.
   * The active-role grant is intentionally left in place.
   */
  async applyEndedPermissions(
    guild: Guild,
    categoryId: string,
    perCtfRoleId: string
  ): Promise<void> {
    const category = guild.channels.cache.get(categoryId) as CategoryChannel | undefined;
    if (!category) {
      logger.warn(`applyEndedPermissions: category not found: ${categoryId}`);
      return;
    }

    if (perCtfRoleId) {
      await category.permissionOverwrites.edit(perCtfRoleId, { ViewChannel: true });
    }
    await category.permissionOverwrites.edit(config.VIEW_ALL_CTF_ROLEID, { ViewChannel: true });
  }

  /**
   * Revert any CTF whose time has run out to ended-phase visibility.
   * Idempotent via the post_end_opened flag. Returns the number reverted.
   */
  async syncEndedCTFs(guild: Guild): Promise<number> {
    const all = await databaseService.getAllCTFs();
    const now = Math.floor(Date.now() / 1000);
    let reverted = 0;

    for (const { key, data } of all) {
      if (data.archived || data.channelsPurged) continue;
      if (!data.cate || data.cate === '0') continue;
      if (data.postEndOpened) continue;
      if (isCtfLive(data.endtime, now)) continue;
      if (!guild.channels.cache.has(data.cate)) continue;

      await this.applyEndedPermissions(guild, data.cate, data.role);
      await databaseService.updateCTF(key, { postEndOpened: true });
      reverted++;
      logger.info(`Reverted ended CTF to normal visibility: ${data.name}`);
    }

    return reverted;
  }
```

- [ ] **Step 3: Use live permissions in createCTFCategory**

In `createCTFCategory`, delete the `viewAllRole` fetch and the entire "Set permissions" block (the per-CTF `ViewChannel: true` create, the `viewAllRole` create, and the `DENY_CTF_ROLEID` create) and replace with:

```typescript
      // Live-phase visibility: active role only
      await this.applyLivePermissions(guild, category.id, role.id);
```

(Keep the info-channel creation and challenge-channel loop below unchanged.)

- [ ] **Step 4: Use live permissions in createSpecialCTFCategory**

In `createSpecialCTFCategory`, likewise delete the `viewAllRole` fetch and the "Set permissions" block and replace with:

```typescript
      // Live-phase visibility: active role only
      await this.applyLivePermissions(guild, category.id, role.id);
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: PASS. If `CategoryChannel` is not already imported in this file, add it to the discord.js import (it is used by existing methods, so it should already be imported).

- [ ] **Step 6: Commit**

```bash
git add src/services/discord.service.ts
git commit -m "feat: active-role live gating and ended-CTF sweep in discord service"
```

---

### Task 5: Hook the sweep into commands

**Files:**
- Modify: `src/commands/ctftime/reg.ts`
- Modify: `src/commands/admin/reg-special.ts`
- Modify: `src/commands/admin/fix.ts`

**Interfaces:**
- Consumes: `discordService.syncEndedCTFs(guild)`.

- [ ] **Step 1: Sweep after CTFtime registration**

In `src/commands/ctftime/reg.ts`, after the CTF is added to the database (after the `databaseService.addCTF(...)` call succeeds, before/after the success reply), add:

```typescript
        // Revert any CTFs whose time has run out
        await discordService.syncEndedCTFs(interaction.guild);
```

(`discordService` is already imported in this file.)

- [ ] **Step 2: Sweep after special registration**

In `src/commands/admin/reg-special.ts`, after the special CTF is created and stored, add the same call:

```typescript
      await discordService.syncEndedCTFs(interaction.guild);
```

Confirm `discordService` is imported; it is used at line 37 for `createSpecialCTFCategory`.

- [ ] **Step 3: Sweep inside admin-fix**

In `src/commands/admin/fix.ts`, add the import if missing:

```typescript
import discordService from '../../services/discord.service';
```

Then, after the existing archived-info-channel loop computes `fixedCount`, add before building `msg`:

```typescript
      const reverted = await discordService.syncEndedCTFs(interaction.guild);
```

and change the `msg` line to include it:

```typescript
      const msg = `Fixed ${fixedCount} archived CTF info channel(s). Reverted ${reverted} ended CTF(s) to normal visibility.` +
        (errors.length > 0 ? `\nFailed: ${errors.join(', ')}` : '');
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/commands/ctftime/reg.ts src/commands/admin/reg-special.ts src/commands/admin/fix.ts
git commit -m "feat: run ended-CTF sweep on create and /admin-fix"
```

---

### Task 6: One-off fix script for existing categories

**Files:**
- Create: `scripts/fix-ctf-visibility.ts`

**Interfaces:**
- Consumes: `BOT_TOKEN`, `SERVER_ID`, `ACTIVE_CTF_ROLEID`, `VIEW_ALL_CTF_ROLEID`, `DENY_CTF_ROLEID`, `DB_PATH`; the `ctfs` table.

- [ ] **Step 1: Write the script**

Create `scripts/fix-ctf-visibility.ts`:

```typescript
import 'dotenv/config';
import Database from 'better-sqlite3';
import { REST, Routes } from 'discord.js';
import path from 'path';

/**
 * Bring existing CTF categories into the active-role visibility model.
 *   live  (now <  endtime): active role only          -> post_end_opened = 0
 *   ended (now >= endtime): + per-CTF role + VIEW_ALL  -> post_end_opened = 1
 * Skips archived and purged CTFs. DRY RUN by default; pass --apply to write.
 *
 *   npx tsx scripts/fix-ctf-visibility.ts
 *   npx tsx scripts/fix-ctf-visibility.ts --apply
 */

const APPLY = process.argv.includes('--apply');
const VIEW_CHANNEL = 1 << 10; // 1024

const token = process.env.BOT_TOKEN;
const guildId = process.env.SERVER_ID;
const activeRoleId = process.env.ACTIVE_CTF_ROLEID;
const viewAllRoleId = process.env.VIEW_ALL_CTF_ROLEID;
const denyRoleId = process.env.DENY_CTF_ROLEID;

if (!token || !guildId || !activeRoleId || !viewAllRoleId) {
  console.error('Missing BOT_TOKEN / SERVER_ID / ACTIVE_CTF_ROLEID / VIEW_ALL_CTF_ROLEID in .env');
  process.exit(1);
}

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'ctf.db');
const db = new Database(DB_PATH);
const rest = new REST({ version: '10' }).setToken(token);

interface CTFRow {
  id: number;
  name: string;
  role: string;
  cate: string;
  endtime: number;
  archived: number;
  channels_purged: number;
}

// PUT a role permission overwrite (type 0 = role).
async function putOverwrite(channelId: string, roleId: string, allow: number, deny: number) {
  await rest.put(Routes.channelPermission(channelId, roleId), {
    body: { type: 0, allow: String(allow), deny: String(deny) },
    reason: 'CTF active-role visibility migration',
  });
}

async function deleteOverwrite(channelId: string, roleId: string) {
  try {
    await rest.delete(Routes.channelPermission(channelId, roleId), {
      reason: 'CTF active-role visibility migration',
    });
  } catch {
    // no such overwrite — fine
  }
}

async function main() {
  try {
    await rest.get(Routes.user('@me'));
  } catch {
    console.error('Invalid BOT_TOKEN — aborting.');
    db.close();
    process.exit(1);
  }

  const rows = db
    .prepare('SELECT id, name, role, cate, endtime, archived, channels_purged FROM ctfs')
    .all() as CTFRow[];
  const now = Math.floor(Date.now() / 1000);

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — inspecting ${rows.length} CTF(s)\n`);

  let live = 0;
  let ended = 0;
  let skipped = 0;

  for (const row of rows) {
    if (row.archived === 1 || row.channels_purged === 1 || !row.cate || row.cate === '0') {
      skipped++;
      continue;
    }
    const isLive = now < row.endtime;

    if (!APPLY) {
      console.log(`[${isLive ? 'LIVE ' : 'ENDED'}] ${row.name} — cate ${row.cate}`);
      isLive ? live++ : ended++;
      continue;
    }

    try {
      if (isLive) {
        await putOverwrite(row.cate, activeRoleId!, VIEW_CHANNEL, 0);
        if (denyRoleId) await putOverwrite(row.cate, denyRoleId, 0, VIEW_CHANNEL);
        await deleteOverwrite(row.cate, row.role);
        await deleteOverwrite(row.cate, viewAllRoleId!);
        db.prepare("UPDATE ctfs SET post_end_opened = 0, updated_at = strftime('%s','now') WHERE id = ?").run(row.id);
        console.log(`[LIVE ] ${row.name} — active-only applied`);
        live++;
      } else {
        await putOverwrite(row.cate, activeRoleId!, VIEW_CHANNEL, 0);
        await putOverwrite(row.cate, row.role, VIEW_CHANNEL, 0);
        await putOverwrite(row.cate, viewAllRoleId!, VIEW_CHANNEL, 0);
        db.prepare("UPDATE ctfs SET post_end_opened = 1, updated_at = strftime('%s','now') WHERE id = ?").run(row.id);
        console.log(`[ENDED] ${row.name} — per-CTF + VIEW_ALL granted`);
        ended++;
      }
    } catch (err) {
      console.error(`[FAIL ] ${row.name} (cate ${row.cate}):`, err);
    }
  }

  console.log(`\nDone: ${live} live, ${ended} ended, ${skipped} skipped.`);
  if (!APPLY) console.log('\nRe-run with --apply to write these changes.');
  db.close();
}

main().catch((err) => {
  console.error(err);
  db.close();
  process.exit(1);
});
```

- [ ] **Step 2: Verify (dry run)**

Run: `npx tsx scripts/fix-ctf-visibility.ts`
Expected: prints `DRY RUN`, lists each non-archived/non-purged CTF as `[LIVE ]` or `[ENDED]`, and a summary. No changes made.

- [ ] **Step 3: Commit the script**

```bash
git add scripts/fix-ctf-visibility.ts
git commit -m "feat: add one-off script to migrate existing CTF visibility"
```

- [ ] **Step 4: Apply against the live guild (manual, after review)**

Only after reviewing the dry-run output, run:
`npx tsx scripts/fix-ctf-visibility.ts --apply`
Expected: each CTF reported `[LIVE ]`/`[ENDED]`, summary with 0 failures. Spot-check in Discord that a live category is visible only to the active role and an ended one is visible to per-CTF + VIEW_ALL.

---

## Notes for the implementer

- Do not stage `.env` (gitignored). The bot will fail fast on startup if `ACTIVE_CTF_ROLEID` is unset, so ensure it is present locally before running.
- `permissionOverwrites.edit(roleId, opts)` upserts and is idempotent; re-running the sweep is safe.
- The service helpers require a gateway `Guild` (used by the bot). The one-off script deliberately uses REST directly (no gateway login), matching `check-purged.ts` / `purge-stale-roles.ts`.
