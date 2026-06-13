import axios, { AxiosError } from 'axios';
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
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

interface CacheEntry {
  data: CTFTimeEvent[];
  timestamp: number;
}

interface APICache {
  events: CacheEntry | null;
}

/**
 * CTFtime service for interacting with CTFtime.org API
 */
class CTFTimeService {
  private cache: APICache;

  constructor() {
    this.cache = {
      events: null,
    };
  }

  /**
   * Check if cache is still valid
   */
  private isCacheValid(cacheEntry: CacheEntry | null): boolean {
    if (!cacheEntry) return false;
    return Date.now() - cacheEntry.timestamp < CACHE_TTL;
  }

  /**
   * Fetch all events from CTFTime API (limit 1000)
   * Includes events from the past 7 days to capture ongoing events
   */
  private async fetchAllEvents(): Promise<CTFTimeEvent[]> {
    const startTime = Date.now();

    if (this.isCacheValid(this.cache.events)) {
      logger.info(
        `Using cached events (age: ${Math.floor((Date.now() - this.cache.events!.timestamp) / 1000)}s)`
      );
      return this.cache.events!.data;
    }

    try {
      const apiStartTime = Date.now();
      // Include events that started in the last 7 days to capture ongoing events
      const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
      const response = await axios.get<CTFTimeEvent[]>(`${CTFTIME_API_BASE}/events/?limit=1000&start=${sevenDaysAgo}`, {
        headers: { 'User-Agent': USER_AGENT },
      });
      const apiEndTime = Date.now();

      const data = response.data;
      this.cache.events = {
        data,
        timestamp: Date.now(),
      };

      const totalTime = Date.now() - startTime;
      logger.info(
        `Fetched events from API - API fetch: ${apiEndTime - apiStartTime}ms, Total: ${totalTime}ms, Events: ${data.length}`
      );

      return data;
    } catch (error) {
      logger.error('Error fetching events from API:', error);
      // Return cached data even if expired, as fallback
      if (this.cache.events) {
        logger.warn('Returning stale cache due to fetch error');
        return this.cache.events.data;
      }
      return [];
    }
  }

  /**
   * Fetch CTF details by ID
   */
  async getCTF(
    ctftimeId: number,
    creating: boolean = false,
    username?: string,
    password?: string
  ): Promise<CTFInfo | CTFEmbedData | null> {
    try {
      const startTimeMs = Date.now();

      const apiStartTime = Date.now();
      const response = await axios.get<CTFTimeEvent>(`${CTFTIME_API_BASE}/events/${ctftimeId}/`, {
        headers: { 'User-Agent': USER_AGENT },
      });
      const apiEndTime = Date.now();

      const processingStartTime = Date.now();
      const data = response.data;

      // Parse timestamps
      const startTime = parseISOToTimestamp(data.start);
      const endTime = calculateEndTime(startTime, data.duration.hours, data.duration.days);

      // Build embed fields
      const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

      // Add login info if creating
      if (creating) {
        const loginValue =
          username && password
            ? `Username: ${username}\nPassword: ${password}`
            : 'Đang đợi ai đó /regacc...';
        fields.push({ name: 'Login', value: loginValue });
      }

      // Time field
      fields.push({
        name: 'Time',
        value: `Start: <t:${startTime}:t> <t:${startTime}:d>\nEnd: <t:${endTime}:t> <t:${endTime}:d>`,
      });

      // Rating weight field
      fields.push({
        name: 'Rating weight',
        value: data.weight.toString(),
      });

      // Format field (only if not plain Jeopardy)
      const formattedFormat = formatCTFFormat(
        data.format,
        data.onsite,
        data.location,
        data.restrictions
      );
      if (formattedFormat) {
        fields.push({
          name: 'Format',
          value: formattedFormat,
        });
      }

      // Discord link field
      const discordLink = extractDiscordLink(data.description);
      if (discordLink) {
        fields.push({
          name: 'Discord',
          value: discordLink,
        });
      }

      // Handle logo
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

      const processingEndTime = Date.now();
      const totalTime = processingEndTime - startTimeMs;

      logger.info(
        `getCTF timing - API: ${apiEndTime - apiStartTime}ms, Processing: ${processingEndTime - processingStartTime}ms, Total: ${totalTime}ms, CTF ID: ${ctftimeId}`
      );

      if (creating) {
        // Return with archive time (1 week after end)
        return {
          title: data.title,
          startTime,
          endTime: endTime + 604800, // Add 1 week (604800 seconds)
          embedData,
        };
      }

      return embedData;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        if (axiosError.response?.status === 404) {
          logger.warn(`CTF not found: ${ctftimeId}`);
          return null;
        }
      }
      logger.error(`Error fetching CTF ${ctftimeId}:`, error);
      return null;
    }
  }

  /**
   * Find CTF by search key (name) using API
   */
  async findCTF(searchKey: string): Promise<number> {
    try {
      const startTime = Date.now();

      const apiStartTime = Date.now();
      const events = await this.fetchAllEvents();
      const apiEndTime = Date.now();

      const processingStartTime = Date.now();

      // Search for matching CTF
      for (const ctf of events) {
        if (fuzzyMatch(searchKey, ctf.title)) {
          const processingEndTime = Date.now();
          const totalTime = processingEndTime - startTime;

          logger.info(
            `findCTF timing - API fetch: ${apiEndTime - apiStartTime}ms, Processing: ${processingEndTime - processingStartTime}ms, Total: ${totalTime}ms, Events searched: ${events.length}, Found: ${ctf.id}`
          );
          return ctf.id;
        }
      }

      const processingEndTime = Date.now();
      const totalTime = processingEndTime - startTime;

      logger.warn(`CTF not found with search key: ${searchKey}`);
      logger.info(
        `findCTF timing - API fetch: ${apiEndTime - apiStartTime}ms, Processing: ${processingEndTime - processingStartTime}ms, Total: ${totalTime}ms, Events searched: ${events.length}`
      );
      return 0;
    } catch (error) {
      logger.error('Error searching for CTF:', error);
      return 0;
    }
  }

  /**
   * Get upcoming CTFs with pagination from API
   */
  async getUpcomingCTF(page: number = 0, step: number = 3): Promise<UpcomingCTFsResult | null> {
    try {
      const startTime = Date.now();

      if (!isValidPagination(page, step)) {
        return null;
      }

      const apiStartTime = Date.now();
      const events = await this.fetchAllEvents();
      const apiEndTime = Date.now();

      const processingStartTime = Date.now();

      const pagination = calculatePagination(events.length, page, step);

      if (!pagination.isValidPage) {
        return null;
      }

      const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
      let warnedFooter = '';

      for (let i = 0; i < pagination.itemsToShow; i++) {
        const ctf = events[step * page + i];
        const startTimestamp = parseISOToTimestamp(ctf.start);
        const endTimestamp = calculateEndTime(startTimestamp, ctf.duration.hours, ctf.duration.days);

        // Check for long events
        const isLong = endTimestamp - startTimestamp > 432000; // 5 days in seconds
        const warning = isLong ? '⏰' : '';
        if (isLong && !warnedFooter.includes('⏰')) {
          warnedFooter = '⏰: Event(s) dài > 5 ngày';
        }

        // Add format emoji
        const emoji = getFormatEmoji(ctf.format);
        const name = emoji + ctf.title;

        fields.push({
          name,
          value: `${ctf.ctftime_url}\nStart: <t:${startTimestamp}:t> <t:${startTimestamp}:d>\nEnd: <t:${endTimestamp}:t> <t:${endTimestamp}:d>${warning}`,
        });
      }

      const timezoneNote = 'Times are shown in your local timezone';
      const pageInfo = `Page ${page + 1}/${pagination.totalPages}`;
      const footer = warnedFooter
        ? `${warnedFooter}\n${pageInfo}\n${timezoneNote}`
        : `${pageInfo}\n${timezoneNote}`;

      const processingEndTime = Date.now();
      const totalTime = processingEndTime - startTime;

      logger.info(
        `getUpcomingCTF timing - API fetch: ${apiEndTime - apiStartTime}ms, Processing: ${processingEndTime - processingStartTime}ms, Total: ${totalTime}ms, Events fetched: ${events.length}`
      );

      return {
        embed: {
          title: 'Upcoming CTFs',
          description: '',
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

  /**
   * Get ongoing CTFs from API
   */
  async getOngoingCTF(limitEventDuration: boolean = true): Promise<OngoingCTFsResult | null> {
    try {
      const startTimeMs = Date.now();

      const now = Math.floor(Date.now() / 1000); // Current time in seconds

      const apiStartTime = Date.now();
      // Use cached events instead of making a new API call
      const events = await this.fetchAllEvents();
      const apiEndTime = Date.now();

      const processingStartTime = Date.now();

      const fields: Array<{ name: string; value: string; inline?: boolean }> = [];
      let warnedFooter: string | undefined;

      for (const ctf of events) {
        const startTimestamp = parseISOToTimestamp(ctf.start);
        const endTimestamp = calculateEndTime(startTimestamp, ctf.duration.hours, ctf.duration.days);

        // Check if event is currently ongoing
        if (startTimestamp < now && now < endTimestamp) {
          const eventDuration = endTimestamp - startTimestamp;
          const isLong = eventDuration > 432000; // 5 days in seconds

          // Skip long events if limit is enabled
          if (limitEventDuration && isLong) {
            continue;
          }

          const warning = isLong ? '⏰' : '';
          if (isLong && !warnedFooter) {
            warnedFooter = '⏰: Event(s) dài > 5 ngày không được tính rating trên Ctftime';
          }

          // Add format emoji
          const emoji = getFormatEmoji(ctf.format);
          const name = emoji + ctf.title;

          fields.push({
            name,
            value: `${ctf.ctftime_url}\nStart: <t:${startTimestamp}:t> <t:${startTimestamp}:d>\nEnd: <t:${endTimestamp}:t> <t:${endTimestamp}:d>${warning}`,
          });
        }
      }

      const title = fields.length === 0 ? 'No results found.' : 'Ongoing CTFs';

      // Update footer to include timezone note
      const timezoneNote = 'Times are shown in your local timezone';
      const footer = warnedFooter ? `${warnedFooter}\n${timezoneNote}` : timezoneNote;

      const processingEndTime = Date.now();
      const totalTime = processingEndTime - startTimeMs;

      logger.info(
        `getOngoingCTF timing - API fetch: ${apiEndTime - apiStartTime}ms, Processing: ${processingEndTime - processingStartTime}ms, Total: ${totalTime}ms, Events found: ${fields.length}`
      );

      return {
        embed: {
          title,
          description: '',
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

  /**
   * Get list of registered CTFs from database
   */
  async getListCTF(
    order: 'Mới nhất' | 'Cũ nhất' = 'Mới nhất',
    page: number = 0,
    step: number = 5
  ): Promise<ListCTFsResult | null> {
    try {
      if (!isValidPagination(page, step)) {
        return null;
      }

      const sortOrder = order === 'Mới nhất' ? 'newest' : 'oldest';
      const allCTFs = await databaseService.getAllCTFs(sortOrder);

      if (allCTFs.length === 0) {
        return null;
      }

      const pagination = calculatePagination(allCTFs.length, page, step);

      if (!pagination.isValidPage) {
        return null;
      }

      const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

      for (let i = 0; i < pagination.itemsToShow; i++) {
        const ctf = allCTFs[step * page + i];

        let emoji: string;
        let fieldValue: string;

        if (ctf.data.channelsPurged) {
          emoji = '🗑️ ';
        } else if (ctf.data.archived) {
          emoji = '📦 ';
        } else {
          emoji = '🟢 ';
        }

        if (ctf.data.ctftimeid > 0) {
          fieldValue = `\`CTFTime ID: ${ctf.data.ctftimeid}\``;
        } else {
          fieldValue = `\`Cate ID: ${ctf.data.cate}\``;
        }

        fields.push({
          name: emoji + ctf.data.name,
          value: fieldValue,
        });
      }

      const footer = `Page ${page + 1}/${pagination.totalPages}`;

      return {
        embed: {
          title: 'CTF List',
          description: '🟢 Active  •  📦 Archived  •  🗑️ Purged',
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
