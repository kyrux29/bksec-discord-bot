import 'dotenv/config';
import Database from 'better-sqlite3';
import { REST, Routes } from 'discord.js';
import path from 'path';

/**
 * Bring existing CTF categories into the active-role visibility model.
 *   live  (now <  endtime): active role only           -> post_end_opened = 0
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

// Ensure the column exists — the bot creates it on startup, but this script may
// run before the bot has restarted. Safe to run even if already migrated.
try {
  db.exec('ALTER TABLE ctfs ADD COLUMN post_end_opened INTEGER NOT NULL DEFAULT 0');
} catch {
  // column already exists
}

const rest = new REST({ version: '10' }).setToken(token);

interface CTFRow {
  id: number;
  name: string;
  role: string;
  cate: string;
  channel: string;
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

/**
 * Make a channel's overwrites exactly match its category's, i.e. what Discord
 * calls "synced". A synced channel then tracks future category changes.
 */
async function syncToCategory(channelId: string, categoryId: string) {
  const category = (await rest.get(Routes.channel(categoryId))) as {
    permission_overwrites?: Array<{ id: string; type: number; allow: string; deny: string }>;
  };
  await rest.patch(Routes.channel(channelId), {
    body: { permission_overwrites: category.permission_overwrites ?? [] },
    reason: 'CTF active-role visibility migration: re-sync to category',
  });
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
    .prepare('SELECT id, name, role, cate, channel, endtime, archived, channels_purged FROM ctfs')
    .all() as CTFRow[];
  const now = Math.floor(Date.now() / 1000);

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — inspecting ${rows.length} CTF(s)\n`);

  let live = 0;
  let ended = 0;
  let skipped = 0;
  let failed = 0;

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
        // @everyone has ViewChannel in this guild's base perms — deny explicitly.
        await putOverwrite(row.cate, guildId!, 0, VIEW_CHANNEL);
        await putOverwrite(row.cate, activeRoleId!, VIEW_CHANNEL, 0);
        if (denyRoleId) await putOverwrite(row.cate, denyRoleId, 0, VIEW_CHANNEL);
        await deleteOverwrite(row.cate, row.role);
        await deleteOverwrite(row.cate, viewAllRoleId!);
        db.prepare(
          "UPDATE ctfs SET post_end_opened = 0, updated_at = strftime('%s','now') WHERE id = ?"
        ).run(row.id);
        console.log(`[LIVE ] ${row.name} — active-only applied`);
        live++;
      } else {
        // @everyone stays denied so access remains role-gated.
        await putOverwrite(row.cate, guildId!, 0, VIEW_CHANNEL);
        await putOverwrite(row.cate, activeRoleId!, VIEW_CHANNEL, 0);
        await putOverwrite(row.cate, row.role, VIEW_CHANNEL, 0);
        await putOverwrite(row.cate, viewAllRoleId!, VIEW_CHANNEL, 0);
        db.prepare(
          "UPDATE ctfs SET post_end_opened = 1, updated_at = strftime('%s','now') WHERE id = ?"
        ).run(row.id);
        console.log(`[ENDED] ${row.name} — per-CTF + VIEW_ALL granted`);
        ended++;
      }

      // The info channel must carry NO overwrites of its own — any overwrite desyncs
      // it from the category and it stops tracking the category's @everyone deny.
      // Re-sync it by replacing its overwrite list with the category's, so whoever
      // can see the category can both view and talk in it.
      if (row.channel && row.channel !== '0') {
        await syncToCategory(row.channel, row.cate);
        console.log(`         info channel -> re-synced to category`);
      }
    } catch (err) {
      console.error(`[FAIL ] ${row.name} (cate ${row.cate}):`, err);
      failed++;
    }
  }

  console.log(`\nDone: ${live} live, ${ended} ended, ${skipped} skipped, ${failed} failed.`);
  if (!APPLY) console.log('\nRe-run with --apply to write these changes.');
  db.close();
}

main().catch((err) => {
  console.error(err);
  db.close();
  process.exit(1);
});
