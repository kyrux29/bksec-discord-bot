export interface CTFMilestone {
  key: string;
  startsAt: number;
  expiresAt: number;
  text: string;
}

const HOUR = 60 * 60;
const DAY = 24 * HOUR;
const START_WINDOW = 15 * 60;

/**
 * Build non-overlapping CTF notification windows.
 * Remaining-time reminders are omitted when they would start before the event.
 */
export function buildCTFMilestones(start: number, end: number, name: string): CTFMilestone[] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end <= start) {
    return [];
  }

  const milestones: CTFMilestone[] = [
    {
      key: 'before_24h',
      startsAt: start - DAY,
      expiresAt: start - HOUR,
      text: `[REMINDER] **${name}** starts <t:${start}:R>.`,
    },
    {
      key: 'before_1h',
      startsAt: start - HOUR,
      expiresAt: start,
      text: `[REMINDER] **${name}** starts in less than one hour.`,
    },
  ];

  const remainingThresholds = [
    { key: 'remaining_3h', seconds: 3 * HOUR, label: 'three hours' },
    { key: 'remaining_1h', seconds: HOUR, label: 'one hour' },
  ].filter(({ seconds }) => end - start > seconds);

  const firstRemainingAt = remainingThresholds.length
    ? Math.min(...remainingThresholds.map(({ seconds }) => end - seconds))
    : end;

  milestones.push({
    key: 'started',
    startsAt: start,
    expiresAt: Math.min(start + START_WINDOW, firstRemainingAt, end),
    text: `[START] **${name}** has started.`,
  });

  for (let index = 0; index < remainingThresholds.length; index++) {
    const threshold = remainingThresholds[index];
    const nextThreshold = remainingThresholds[index + 1];
    milestones.push({
      key: threshold.key,
      startsAt: end - threshold.seconds,
      expiresAt: nextThreshold ? end - nextThreshold.seconds : end,
      text: `[TIME] **${name}** has less than ${threshold.label} remaining.`,
    });
  }

  milestones.push({
    key: 'ended',
    startsAt: end,
    expiresAt: end + DAY,
    text: `[END] **${name}** has ended.`,
  });

  return milestones.filter((milestone) => milestone.expiresAt > milestone.startsAt);
}
