import { apiDelete, apiGet, apiPost } from './client';
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

export const statisticsApi = {
  /**
   * Get user overall reading summary metrics and device breakdown
   */
  getSummary: async (): Promise<ReadingSummaryResponse> => {
    return apiGet<ReadingSummaryResponse>('/statistics/summary');
  },

  /**
   * Get daily reading activity time-series for charts and heatmap
   */
  getActivity: async (params?: ActivityParams): Promise<DailyActivityResponse[]> => {
    const query = new URLSearchParams();
    if (params?.from) query.set('from', params.from);
    if (params?.to) query.set('to', params.to);
    const qs = query.toString();
    const path = qs ? `/statistics/activity?${qs}` : '/statistics/activity';
    return apiGet<DailyActivityResponse[]>(path);
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
