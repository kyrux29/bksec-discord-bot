import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

async function run(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bksec-challenge-'));process.env.DB_PATH=path.join(dir,'test.db');
 const db=(await import('../services/database.service')).default;
 try{const ctfId=await db.addCTF({ctftimeid:1,role:'1',cate:'2',name:'Test CTF',infom:'3',channel:'4',endtime:200,starttime:100,competitionEndtime:200});
  const challenge=await db.createChallenge({ctfId,threadId:'10',channelId:'11',name:'heap',category:'pwn',points:500});assert.equal(challenge.status,'unclaimed');
  const firstClaim=await db.addChallengeClaimant(challenge.id,'98');assert.equal(firstClaim.added,true);assert.deepEqual(firstClaim.challenge.claimantIds,['98']);
  const secondClaim=await db.addChallengeClaimant(challenge.id,'99');assert.equal(secondClaim.added,true);assert.deepEqual(secondClaim.challenge.claimantIds,['98','99']);
  const duplicateClaim=await db.addChallengeClaimant(challenge.id,'99');assert.equal(duplicateClaim.added,false);
  const released=await db.removeChallengeClaimant(challenge.id,'98');assert.equal(released.removed,true);assert.deepEqual(released.challenge.claimantIds,['99']);
  const solved=await db.updateChallenge(challenge.id,{status:'solved',solverIds:['99'],solvedBy:'99',solvedAt:150});assert.deepEqual(solved.solverIds,['99']);
  assert.equal((await db.getChallengesByCTF(ctfId)).length,1);await db.setDashboard(ctfId,'11','12');assert.equal((await db.getDashboard(ctfId))?.messageId,'12');
  assert.equal(await db.markReminderSent(ctfId,'started'),true);assert.equal(await db.markReminderSent(ctfId,'started'),false);console.log('challenge database tests passed');
 }finally{db.close();fs.rmSync(dir,{recursive:true,force:true});delete process.env.DB_PATH;}}
run().catch((e)=>{console.error(e);process.exitCode=1;});
