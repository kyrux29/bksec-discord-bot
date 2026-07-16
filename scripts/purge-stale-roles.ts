import 'dotenv/config';
import Database from 'better-sqlite3';
import { REST, Routes } from 'discord.js';
import path from 'path';

/**
 * Purge stale CTF roles.
 *
 * When a CTF category is purged (deleteCTFCategory), the channels and category
 * are removed but the per-CTF role is left behind. This finds those orphaned
 * roles (ctfs.channels_purged = 1) and deletes them from the guild.
 *
 * DRY RUN by default. Pass --apply to actually delete.
 *
 *   npx tsx scripts/purge-stale-roles.ts          # preview only
 *   npx tsx scripts/purge-stale-roles.ts --apply  # perform deletion
 */

const APPLY = process.argv.includes('--apply');

const token = process.env.BOT_TOKEN;
const guildId = process.env.SERVER_ID;
if (!token) {
  console.error('BOT_TOKEN not set in .env');
  process.exit(1);
}
if (!guildId) {
  console.error('SERVER_ID not set in .env');
  process.exit(1);
}

// Config roles that must never be deleted even if a row references them.
const PROTECTED_ROLE_IDS = new Set(
  [
    guildId, // @everyone role shares the guild id
    process.env.VIEW_ALL_CTF_ROLEID,
    process.env.DENY_CTF_ROLEID,
    process.env.VERIFIED_ROLE_ID,
    process.env.ADMIN_ROLE_ID,
  ].filter((v): v is string => Boolean(v))
);

const DB_PATH = process.env.DB_PATH ?? path.join(process.cwd(), 'ctf.db');
const db = new Database(DB_PATH);

const rest = new REST({ version: '10' }).setToken(token);

interface CTFRow {
  id: number;
  name: string;
  role: string;
  channels_purged: number;
}

interface GuildRole {
  id: string;
  name: string;
  managed: boolean;
  position: number;
}

async function main() {
  // 1. Validate token / identity.
  let botUserId: string;
  try {
    const me = (await rest.get(Routes.user('@me'))) as { id: string };
    botUserId = me.id;
  } catch {
    console.error('Invalid BOT_TOKEN — aborting.');
    db.close();
    process.exit(1);
  }

  // 2. Fetch all guild roles once.
  const guildRoles = (await rest.get(Routes.guildRoles(guildId))) as GuildRole[];
  const roleById = new Map(guildRoles.map((r) => [r.id, r]));

  // 3. Determine the bot's highest role position (can't delete roles above it).
  const member = (await rest.get(Routes.guildMember(guildId, botUserId))) as { roles: string[] };
  const botTopPosition = member.roles.reduce((max, rid) => {
    const r = roleById.get(rid);
    return r && r.position > max ? r.position : max;
  }, 0);

  // 4. Build the set of role ids still used by a NON-purged CTF (never delete these).
  const rows = db.prepare('SELECT id, name, role, channels_purged FROM ctfs').all() as CTFRow[];
  const activeRoleIds = new Set(
    rows.filter((r) => r.channels_purged !== 1 && r.role).map((r) => r.role)
  );

  // 5. Candidate stale roles: purged CTFs whose role id is not otherwise in use.
  const purged = rows.filter((r) => r.channels_purged === 1 && r.role);

  console.log(
    `${APPLY ? 'APPLY' : 'DRY RUN'} — ${purged.length} purged CTF(s) to inspect on guild ${guildId}\n`
  );

  let deleted = 0;
  let gone = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of purged) {
    const roleId = row.role;
    const role = roleById.get(roleId);

    if (!role) {
      console.log(`[GONE]  ${row.name} — role ${roleId} already deleted`);
      gone++;
      continue;
    }
    if (PROTECTED_ROLE_IDS.has(roleId)) {
      console.log(`[SKIP]  ${row.name} — role "${role.name}" is a protected/config role`);
      skipped++;
      continue;
    }
    if (activeRoleIds.has(roleId)) {
      console.log(`[SKIP]  ${row.name} — role "${role.name}" still used by an active CTF`);
      skipped++;
      continue;
    }
    if (role.managed) {
      console.log(`[SKIP]  ${row.name} — role "${role.name}" is managed by an integration`);
      skipped++;
      continue;
    }
    if (role.position >= botTopPosition) {
      console.log(
        `[SKIP]  ${row.name} — role "${role.name}" is above the bot in the hierarchy (pos ${role.position} >= ${botTopPosition})`
      );
      skipped++;
      continue;
    }

    if (!APPLY) {
      console.log(`[WOULD] ${row.name} — would delete role "${role.name}" (${roleId})`);
      deleted++;
      continue;
    }

    try {
      await rest.delete(Routes.guildRole(guildId, roleId), {
        reason: 'Stale CTF role — category already purged',
      });
      console.log(`[DEL]   ${row.name} — deleted role "${role.name}" (${roleId})`);
      deleted++;
    } catch (err) {
      console.error(`[FAIL]  ${row.name} — could not delete role ${roleId}:`, err);
      failed++;
    }
  }

  console.log(
    `\nDone: ${deleted} ${APPLY ? 'deleted' : 'to delete'}, ${gone} already gone, ${skipped} skipped, ${failed} failed.`
  );
  if (!APPLY && deleted > 0) {
    console.log('\nRe-run with --apply to actually delete these roles.');
  }
  db.close();
}

main().catch((err) => {
  console.error(err);
  db.close();
  process.exit(1);
});
