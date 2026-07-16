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
