import axios from 'axios';
import {
  CTFTimeEvent,
  CTFInfo,
  CTFEmbedData,
  UpcomingCTFsResult,
  OngoingCTFsResult,
  ListCTFsResult,
} from '../types';
import {
  parseISOToTimestamp,
  calculateEndTime,
  extractDiscordLink,
  formatCTFFormat,
  getFormatEmoji,
  calculatePagination,
  isValidPagination,
  fuzzyMatch,
} from '../utils/helpers';
import logger from '../utils/logger';
import databaseService from './database.service';

const CTFTIME_API_BASE = 'https://ctftime.org/api/v1';
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

const LONG_EVENT_SECONDS = 432000; // 5 days

interface CacheEntry {
  data: CTFTimeEvent[];
  timestamp: number;
}

const elapsed = (start: number) => `${Date.now() - start}ms`;

export class CTFTimeAPIError extends Error {
  constructor(public readonly statusCode?: number) {
    super(statusCode ? `CTFtime API returned HTTP ${statusCode}` : 'CTFtime API unreachable');
    this.name = 'CTFTimeAPIError';
  }
}

class CTFTimeService {
  private cache: CacheEntry | null = null;

  private isCacheValid(): boolean {
    return !!this.cache && Date.now() - this.cache.timestamp < CACHE_TTL;
  }

  private async fetchAllEvents(): Promise<{ data: CTFTimeEvent[]; stale: boolean }> {
    const currentCache = this.cache;
    if (currentCache && this.isCacheValid()) {
      logger.info(
        `Using cached events (age: ${Math.floor((Date.now() - currentCache.timestamp) / 1000)}s)`
      );
      return { data: currentCache.data, stale: false };
    }

    const t = Date.now();
    try {
      const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
      const response = await axios.get<CTFTimeEvent[]>(
        `${CTFTIME_API_BASE}/events/?limit=1000&start=${sevenDaysAgo}`,
        { headers: { 'User-Agent': USER_AGENT } }
      );
      this.cache = { data: response.data, timestamp: Date.now() };
      logger.info(`Fetched ${response.data.length} events from API in ${elapsed(t)}`);
      return { data: response.data, stale: false };
    } catch (error) {
      const statusCode = axios.isAxiosError(error) ? error.response?.status : undefined;
      logger.error(`CTFtime API error${statusCode ? ` (HTTP ${statusCode})` : ''}:`, error);
      if (this.cache) {
        const ageMin = Math.floor((Date.now() - this.cache.timestamp) / 60000);
        logger.warn(`Returning stale cache (${ageMin}m old) due to API error`);
        return { data: this.cache.data, stale: true };
      }
      throw new CTFTimeAPIError(statusCode);
    }
  }

  async getCTF(
    ctftimeId: number,
    creating: boolean = false,
    username?: string,
    password?: string
  ): Promise<CTFInfo | CTFEmbedData | null> {
    const t = Date.now();
    try {
      const response = await axios.get<CTFTimeEvent>(`${CTFTIME_API_BASE}/events/${ctftimeId}/`, {
        headers: { 'User-Agent': USER_AGENT },
      });
      const data = response.data;

      const startTime = parseISOToTimestamp(data.start);
      const endTime = calculateEndTime(startTime, data.duration.hours, data.duration.days);

      const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

      if (creating) {
        const safeUsername = username?.replace(/`/g, 'ˋ');
        const safePassword = password?.replace(/\|/g, '∣');
        fields.push({
          name: 'Login',
          value:
            safeUsername && safePassword
              ? `Username: \`${safeUsername}\`\nPassword: ||${safePassword}||`
              : 'Đang chờ quản trị viên cập nhật bằng `/ct-regacc`.',
        });
      }

      fields.push({
        name: 'Time',
        value: `Start: <t:${startTime}:t> <t:${startTime}:d>\nEnd: <t:${endTime}:t> <t:${endTime}:d>`,
      });

      fields.push({ name: 'Rating weight', value: data.weight.toString() });

      const formattedFormat = formatCTFFormat(
        data.format,
        data.onsite,
        data.location,
        data.restrictions
      );
      if (formattedFormat) fields.push({ name: 'Format', value: formattedFormat });

      const discordLink = extractDiscordLink(data.description);
      if (discordLink) fields.push({ name: 'Discord', value: discordLink });

      const logo = data.logo && data.logo.length > 5 ? data.logo : undefined;

      const embedData: CTFEmbedData = {
        title: data.title,
        description: data.url,
        url: data.url,
        color: 0xd50000,
        thumbnail: logo,
        footer: data.ctftime_url,
        fields,
      };

      logger.info(`getCTF ${ctftimeId} in ${elapsed(t)}`);

      if (creating) {
        return {
          title: data.title,
          startTime,
          endTime,
          archiveAt: endTime + 7 * 24 * 60 * 60,
          embedData,
        };
      }

      return embedData;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        logger.warn(`CTF not found: ${ctftimeId}`);
        return null;
      }
      logger.error(`Error fetching CTF ${ctftimeId}:`, error);
      return null;
    }
  }

  async findCTF(searchKey: string): Promise<number> {
    const t = Date.now();
    try {
      const { data: events } = await this.fetchAllEvents();
      const match = events.find((ctf) => fuzzyMatch(searchKey, ctf.title));
      logger.info(
        `findCTF "${searchKey}" — ${match ? `found ${match.id}` : 'not found'} in ${elapsed(t)}`
      );
      return match?.id ?? 0;
    } catch (error) {
      logger.error('Error searching for CTF:', error);
      throw error;
    }
  }

  async getUpcomingCTF(page: number = 0, step: number = 3): Promise<UpcomingCTFsResult | null> {
    const t = Date.now();
    try {
      if (!isValidPagination(page, step)) return null;

      const now = Math.floor(Date.now() / 1000);
      const { data: events, stale } = await this.fetchAllEvents();

      // Only show events that haven't started yet
      const upcoming = events.filter((ctf) => {
        const start = parseISOToTimestamp(ctf.start);
        return start > now;
      });

      const pagination = calculatePagination(upcoming.length, page, step);
      if (!pagination.isValidPage) return null;

      const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
      let longWarning: string | undefined;

      for (let i = 0; i < pagination.itemsToShow; i++) {
        const ctf = upcoming[step * page + i];
        const startTimestamp = parseISOToTimestamp(ctf.start);
        const endTimestamp = calculateEndTime(
          startTimestamp,
          ctf.duration.hours,
          ctf.duration.days
        );

        const isLong = endTimestamp - startTimestamp > LONG_EVENT_SECONDS;
        if (isLong && !longWarning) longWarning = '⏰: Event(s) dài > 5 ngày';

        fields.push({
          name: getFormatEmoji(ctf.format) + ctf.title,
          value: `${ctf.ctftime_url}\nStart: <t:${startTimestamp}:t> <t:${startTimestamp}:d>\nEnd: <t:${endTimestamp}:t> <t:${endTimestamp}:d>${isLong ? '⏰' : ''}`,
        });
      }

      const pageInfo = `Page ${page + 1}/${pagination.totalPages}`;
      const timezoneNote = 'Times are shown in your local timezone';
      const staleNote = stale ? '⚠️ CTFtime may be down — showing cached data' : undefined;
      const footer = [longWarning, pageInfo, timezoneNote, staleNote].filter(Boolean).join('\n');

      logger.info(`getUpcomingCTF page ${page} in ${elapsed(t)}`);

      return {
        embed: {
          title: 'Upcoming CTFs',
          color: 0xd50000,
          footer,
          timestamp: Date.now(),
          fields,
        },
        totalPages: pagination.totalPages,
      };
    } catch (error) {
      logger.error('Error fetching upcoming CTFs:', error);
      return null;
    }
  }

  async getOngoingCTF(limitEventDuration: boolean = true): Promise<OngoingCTFsResult | null> {
    const t = Date.now();
    try {
      const now = Math.floor(Date.now() / 1000);
      const { data: events, stale } = await this.fetchAllEvents();

      const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
      let longWarning: string | undefined;

      for (const ctf of events) {
        const startTimestamp = parseISOToTimestamp(ctf.start);
        const endTimestamp = calculateEndTime(
          startTimestamp,
          ctf.duration.hours,
          ctf.duration.days
        );

        if (startTimestamp >= now || now >= endTimestamp) continue;

        const isLong = endTimestamp - startTimestamp > LONG_EVENT_SECONDS;
        if (limitEventDuration && isLong) continue;
        if (isLong && !longWarning) {
          longWarning = '⏰: Event(s) dài > 5 ngày không được tính rating trên Ctftime';
        }

        fields.push({
          name: getFormatEmoji(ctf.format) + ctf.title,
          value: `${ctf.ctftime_url}\nStart: <t:${startTimestamp}:t> <t:${startTimestamp}:d>\nEnd: <t:${endTimestamp}:t> <t:${endTimestamp}:d>${isLong ? '⏰' : ''}`,
        });
      }

      const timezoneNote = 'Times are shown in your local timezone';
      const staleNote = stale ? '⚠️ CTFtime may be down — showing cached data' : undefined;
      const footer = [longWarning, timezoneNote, staleNote].filter(Boolean).join('\n');

      logger.info(`getOngoingCTF in ${elapsed(t)}, found ${fields.length} events`);

      return {
        embed: {
          title: fields.length === 0 ? 'No results found.' : 'Ongoing CTFs',
          color: 0xd50000,
          footer,
          timestamp: Date.now(),
          fields,
        },
      };
    } catch (error) {
      logger.error('Error fetching ongoing CTFs:', error);
      return null;
    }
  }

  async getListCTF(
    order: 'Mới nhất' | 'Cũ nhất' = 'Mới nhất',
    page: number = 0,
    step: number = 5
  ): Promise<ListCTFsResult | null> {
    try {
      if (!isValidPagination(page, step)) return null;

      const sortOrder = order === 'Mới nhất' ? 'newest' : 'oldest';
      const allCTFs = await databaseService.getAllCTFs(sortOrder);

      if (allCTFs.length === 0) return null;

      const pagination = calculatePagination(allCTFs.length, page, step);
      if (!pagination.isValidPage) return null;

      const fields = allCTFs.slice(step * page, step * page + pagination.itemsToShow).map((ctf) => {
        const emoji = ctf.data.channelsPurged ? '🗑️ ' : ctf.data.archived ? '📦 ' : '🟢 ';
        const value =
          ctf.data.ctftimeid > 0
            ? `\`CTFTime ID: ${ctf.data.ctftimeid}\``
            : `\`Cate ID: ${ctf.data.cate}\``;
        return { name: emoji + ctf.data.name, value };
      });

      const footer = `Page ${page + 1}/${pagination.totalPages}  •  🟢 Active  📦 Archived  🗑️ Purged`;

      return {
        embed: {
          title: 'CTF List',
          color: 0xd50000,
          footer,
          timestamp: Date.now(),
          fields,
        },
        totalPages: pagination.totalPages,
      };
    } catch (error) {
      logger.error('Error getting CTF list:', error);
      return null;
    }
  }
}

export default new CTFTimeService();
