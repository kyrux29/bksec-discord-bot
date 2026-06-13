import 'dotenv/config';
import Database from 'better-sqlite3';
import { REST, Routes } from 'discord.js';
import path from 'path';

const token = process.env.BOT_TOKEN;
if (!token) {
  console.error('BOT_TOKEN not set in .env');
  process.exit(1);
}

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'ctf.db');
const db = new Database(DB_PATH);

// Ensure column exists (safe to run even if already migrated)
try {
  db.exec('ALTER TABLE ctfs ADD COLUMN channels_purged INTEGER NOT NULL DEFAULT 0');
} catch {
  // column already exists
}

const rest = new REST({ version: '10' }).setToken(token);

interface CTFRow {
  id: number;
  name: string;
  cate: string;
  channels_purged: number;
}

async function validateToken(): Promise<boolean> {
  try {
    await rest.get(Routes.user('@me'));
    return true;
  } catch {
    return false;
  }
}

async function categoryExists(channelId: string): Promise<boolean> {
  try {
    await rest.get(Routes.channel(channelId));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const tokenValid = await validateToken();
  if (!tokenValid) {
    console.error('Invalid BOT_TOKEN — aborting to prevent false purge marks.');
    db.close();
    process.exit(1);
  }

  const rows = db.prepare('SELECT id, name, cate, channels_purged FROM ctfs').all() as CTFRow[];
  console.log(`Checking ${rows.length} CTF(s)...\n`);

  let newlyPurged = 0;
  let alreadyPurged = 0;
  let stillActive = 0;
  let skipped = 0;

  for (const row of rows) {
    if (row.channels_purged === 1) {
      console.log(`[SKIP]   ${row.name} — already marked purged`);
      alreadyPurged++;
      continue;
    }

    if (!row.cate || row.cate === '0') {
      console.log(`[SKIP]   ${row.name} — no category ID stored`);
      skipped++;
      continue;
    }

    const exists = await categoryExists(row.cate);
    if (!exists) {
      db.prepare(
        "UPDATE ctfs SET channels_purged = 1, updated_at = strftime('%s', 'now') WHERE id = ?"
      ).run(row.id);
      console.log(`[PURGED] ${row.name} — category ${row.cate} not found, marked purged`);
      newlyPurged++;
    } else {
      console.log(`[OK]     ${row.name} — category exists`);
      stillActive++;
    }
  }

  console.log(
    `\nDone: ${newlyPurged} newly purged, ${alreadyPurged} already purged, ${stillActive} active, ${skipped} skipped.`
  );
  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
