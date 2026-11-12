import { apiDelete, apiGet, apiPost, type ApiError } from './client';
import type {
  DailyActivityResponse,
  ReadingSummaryResponse,
  BookReadingStatsResponse,
  BookReadingStatisticsItemResponse,
  ReadingSessionItem,
  BatchReadingSessionsResponse,
} from '../types/statistics';

export interface ActivityParams {
  from?: string | null;
  to?: string | null;
}

/**
 * IANA name of the device time zone (e.g. `Europe/Berlin`). The server groups
 * reading time into days and counts streaks in this zone; without it days
 * would be cut at UTC midnight. Servers that do not know the parameter
 * ignore it.
 */
function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * GET a day-based statistics endpoint in the device time zone. A server that
 * does not recognise the zone name answers 400; the request is then repeated
 * without it (UTC days) rather than failing.
 */
async function getInDeviceTimeZone<T>(path: string, query: URLSearchParams): Promise<T> {
  const build = (q: URLSearchParams) => {
    const qs = q.toString();
    return qs ? `${path}?${qs}` : path;
  };
  const tz = deviceTimeZone();
  if (!tz) return apiGet<T>(build(query));

  const withTz = new URLSearchParams(query);
  withTz.set('tz', tz);
  try {
    return await apiGet<T>(build(withTz));
  } catch (err) {
    if ((err as ApiError | null)?.status === 400) {
      return apiGet<T>(build(query));
    }
    throw err;
  }
}

export const statisticsApi = {
  /**
   * Get user overall reading summary metrics and device breakdown
   */
  getSummary: async (): Promise<ReadingSummaryResponse> => {
    return getInDeviceTimeZone<ReadingSummaryResponse>('/statistics/summary', new URLSearchParams());
  },

  /**
   * Get daily reading activity time-series for charts and heatmap
   */
  getActivity: async (params?: ActivityParams): Promise<DailyActivityResponse[]> => {
    const query = new URLSearchParams();
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    return getInDeviceTimeZone<DailyActivityResponse[]>('/statistics/activity', query);
  },

  /**
   * Get aggregated reading statistics for all books read by user with per-book device breakdown
   */
  getBooksStatistics: async (): Promise<BookReadingStatisticsItemResponse[]> => {
    return apiGet<BookReadingStatisticsItemResponse[]>('/statistics/books');
  },

  /**
   * Get reading statistics for a specific book
   */
  getBookStatistics: async (bookId: string): Promise<BookReadingStatsResponse> => {
    return apiGet<BookReadingStatsResponse>(`/books/${bookId}/statistics`);
  },

  /**
   * Delete / reset reading statistics for a specific book
   */
  deleteBookStatistics: async (bookId: string): Promise<void> => {
    await apiDelete(`/books/${bookId}/statistics`);
  },

  /**
   * Record a batch of reading sessions from web or mobile reader
   */
  recordSessions: async (
    sessions: ReadingSessionItem[],
  ): Promise<BatchReadingSessionsResponse> => {
    return apiPost<BatchReadingSessionsResponse>('/statistics/sessions', { sessions });
  },
};
