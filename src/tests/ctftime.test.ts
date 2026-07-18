/**
 * Optional live smoke test for CTFtime. This test requires network access and is
 * intentionally excluded from `bun test`; run it with `bun run test:smoke`.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function runTests(): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bksec-ctftime-'));
  process.env.DB_PATH = path.join(directory, 'test.db');

  const ctftimeService = (await import('../services/ctftime.service')).default;
  const databaseService = (await import('../services/database.service')).default;

  try {
    const upcoming = await ctftimeService.getUpcomingCTF(0, 3);
    assert.ok(upcoming, 'CTFtime should return an upcoming-event page');
    assert.ok(upcoming.embed.fields.length <= 3);

    const details = await ctftimeService.getCTF(2214);
    assert.ok(details && 'fields' in details, 'a known event should be retrievable');

    const registration = await ctftimeService.getCTF(2214, true, 'smoke-user', 'smoke-secret');
    assert.ok(registration && 'archiveAt' in registration);
    assert.equal(registration.archiveAt - registration.endTime, 7 * 24 * 60 * 60);
    const loginField = registration.embedData.fields.find((field) => field.name === 'Login');
    assert.match(loginField?.value ?? '', /Password: \|\|.+\|\|/);

    console.log('CTFtime live smoke tests passed');
  } finally {
    databaseService.close();
    fs.rmSync(directory, { recursive: true, force: true });
    delete process.env.DB_PATH;
  }
}

runTests().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
