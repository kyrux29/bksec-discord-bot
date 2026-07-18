import assert from 'node:assert/strict';
import { buildCTFMilestones } from '../utils/ctf-schedule';

const start = 1_000_000;

const twoHourEvent = buildCTFMilestones(start, start + 2 * 60 * 60, 'Short CTF');
assert.equal(
  twoHourEvent.some((milestone) => milestone.key === 'remaining_3h'),
  false,
  'a two-hour event must not announce three hours remaining'
);
assert.equal(
  twoHourEvent.find((milestone) => milestone.key === 'remaining_1h')?.startsAt,
  start + 60 * 60
);

const thirtyMinuteEvent = buildCTFMilestones(start, start + 30 * 60, 'Sprint CTF');
assert.equal(
  thirtyMinuteEvent.some((milestone) => milestone.key.startsWith('remaining_')),
  false,
  'remaining-time reminders must not begin before a short event starts'
);
assert.ok(
  thirtyMinuteEvent.every((milestone) => milestone.expiresAt > milestone.startsAt),
  'all notification windows must have positive duration'
);

const fourHourEvent = buildCTFMilestones(start, start + 4 * 60 * 60, 'Normal CTF');
assert.equal(
  fourHourEvent.find((milestone) => milestone.key === 'remaining_3h')?.startsAt,
  start + 60 * 60
);
assert.equal(
  fourHourEvent.find((milestone) => milestone.key === 'remaining_1h')?.startsAt,
  start + 3 * 60 * 60
);

assert.deepEqual(buildCTFMilestones(start, start, 'Invalid CTF'), []);
assert.deepEqual(buildCTFMilestones(0, start, 'Invalid CTF'), []);

console.log('ctf-schedule tests passed');
