import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

async function run(): Promise<void> {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bksec-challenge-'));
  process.env.DB_PATH = path.join(directory, 'test.db');
  const databaseService = (await import('../services/database.service')).default;

  try {
    const ctfId = await databaseService.addCTF({
      ctftimeid: 1,
      role: '1',
      cate: '2',
      name: 'Test CTF',
      infom: '3',
      channel: '4',
      endtime: 300,
      starttime: 100,
      competitionEndtime: 200,
    });
    const storedCTF = await databaseService.findByKey(String(ctfId));
    assert.equal(storedCTF?.data.endtime, 300, 'archive time should be stored separately');
    assert.equal(storedCTF?.data.competitionEndtime, 200);

    const legacyId = await databaseService.addCTF({
      ctftimeid: 2,
      role: 'legacy-role',
      cate: 'legacy-category',
      name: 'Legacy buffered CTF',
      infom: 'legacy-message',
      channel: 'legacy-channel',
      endtime: 700_000,
    });
    databaseService.ensureDatabase();
    const migratedCTF = await databaseService.findByKey(String(legacyId));
    assert.equal(
      migratedCTF?.data.competitionEndtime,
      95_200,
      'legacy CTFtime rows should recover the actual competition end time'
    );

    const challenge = await databaseService.createChallenge({
      ctfId,
      threadId: '10',
      channelId: '11',
      name: 'heap',
      category: 'pwn',
      points: 500,
    });
    assert.equal(challenge.status, 'unclaimed');

    const firstClaim = await databaseService.addChallengeClaimant(challenge.id, '98');
    assert.equal(firstClaim.added, true);
    assert.deepEqual(firstClaim.challenge.claimantIds, ['98']);

    const secondClaim = await databaseService.addChallengeClaimant(challenge.id, '99');
    assert.equal(secondClaim.added, true);
    assert.deepEqual(secondClaim.challenge.claimantIds, ['98', '99']);

    const duplicateClaim = await databaseService.addChallengeClaimant(challenge.id, '99');
    assert.equal(duplicateClaim.added, false);

    const released = await databaseService.removeChallengeClaimant(challenge.id, '98');
    assert.equal(released.removed, true);
    assert.deepEqual(released.challenge.claimantIds, ['99']);

    const solved = await databaseService.solveChallenge({
      challengeId: challenge.id,
      solverIds: ['99'],
      recordedBy: '97',
      solvedAt: 150,
      points: 450,
    });
    assert.equal(solved.status, 'solved');
    assert.deepEqual(solved.solverIds, ['99']);
    assert.equal(solved.points, 450);
    assert.equal((await databaseService.getSolvedChallenges(ctfId)).length, 1);

    await assert.rejects(
      databaseService.solveChallenge({
        challengeId: challenge.id,
        solverIds: ['99'],
        recordedBy: '97',
        solvedAt: 151,
        points: 450,
      }),
      /already solved/
    );

    const reopened = await databaseService.undoChallengeSolve(challenge.id);
    assert.equal(reopened.status, 'working');
    assert.deepEqual(reopened.solverIds, []);
    assert.equal((await databaseService.getSolvedChallenges(ctfId)).length, 0);

    assert.equal((await databaseService.getChallengesByCTF(ctfId)).length, 1);
    await databaseService.setDashboard(ctfId, '11', '12');
    assert.equal((await databaseService.getDashboard(ctfId))?.messageId, '12');

    assert.equal(await databaseService.markReminderSent(ctfId, 'started'), true);
    assert.equal(await databaseService.markReminderSent(ctfId, 'started'), false);
    await databaseService.removeReminder(ctfId, 'started');
    assert.equal(await databaseService.markReminderSent(ctfId, 'started'), true);

    console.log('challenge database tests passed');
  } finally {
    databaseService.close();
    fs.rmSync(directory, { recursive: true, force: true });
    delete process.env.DB_PATH;
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
