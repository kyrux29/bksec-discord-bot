/**
 * Utility helper functions
 */

/**
 * Parse ISO 8601 datetime string to Unix timestamp
 */
export function parseISOToTimestamp(isoString: string): number {
  return Math.floor(new Date(isoString).getTime() / 1000);
}

/**
 * Calculate end time from start time and duration
 */
export function calculateEndTime(startTimestamp: number, hours: number, days: number): number {
  const durationSeconds = (hours + 24 * days) * 3600;
  return startTimestamp + durationSeconds;
}

/**
 * Check if event duration is longer than specified days
 */
export function isLongEvent(
  durationHours: number,
  durationDays: number,
  thresholdDays: number = 5
): boolean {
  const totalHours = durationHours + 24 * durationDays;
  return totalHours > thresholdDays * 24;
}

/**
 * Extract Discord invite link from description text
 */
export function extractDiscordLink(description: string): string | null {
  if (!description.includes('discord.gg')) {
    return null;
  }

  let discordLink = 'https://';
  let index = description.indexOf('discord.gg');
  const invalidChars = '\r\n \t%*^$#@?=';

  for (let j = 0; j < 25; j++) {
    if (index >= description.length) break;

    const char = description[index];
    if (!invalidChars.includes(char)) {
      discordLink += char;
    } else {
      break;
    }
    index++;
  }

  return discordLink;
}

/**
 * Format CTF format string with emojis
 */
export function formatCTFFormat(
  format: string,
  onsite: boolean,
  location: string,
  restrictions: string
): string | null {
  let formatted = format;

  if (format === 'Attack-Defense') {
    formatted += ' ⚔';
  } else if (format === 'Hack quest') {
    formatted += ' 🌄';
  }

  if (onsite) {
    formatted += `\nOn-site: ${location}`;
  }

  if (restrictions !== 'Open') {
    formatted += `\nRestricted (${restrictions})`;
  }

  // Return null for plain Jeopardy format (most common)
  if (formatted === 'Jeopardy') {
    return null;
  }

  return formatted;
}

/**
 * Get format emoji prefix for CTF title
 */
export function getFormatEmoji(format: string): string {
  if (format === 'Attack-Defense') {
    return '⚔ ';
  } else if (format === 'Hack quest') {
    return '🌄 ';
  }
  return '';
}

/**
 * Calculate pagination values
 */
export function calculatePagination(totalItems: number, page: number, step: number) {
  const totalPages = Math.ceil(totalItems / step);

  if (page >= totalPages) {
    return { totalPages, itemsToShow: 0, isValidPage: false };
  }

  const itemsToShow = page === totalPages - 1 ? totalItems - page * step : step;

  return {
    totalPages,
    itemsToShow,
    isValidPage: true,
  };
}

/**
 * Validate pagination parameters
 */
export function isValidPagination(page: number, step: number): boolean {
  return step >= 1 && page >= 0;
}

/**
 * Sleep/delay function
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Truncate string to max length
 */
export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

/**
 * Remove extra spaces and normalize string
 */
export function normalizeString(str: string): string {
  return str.trim().replace(/\s+/g, ' ');
}

/**
 * Case-insensitive string matching (used for CTF search)
 */
export function fuzzyMatch(searchKey: string, target: string): boolean {
  const normalizedSearch = searchKey.replace(/\s/g, '').toLowerCase();
  const normalizedTarget = target.replace(/\s/g, '').toLowerCase();
  return normalizedTarget.includes(normalizedSearch);
}
