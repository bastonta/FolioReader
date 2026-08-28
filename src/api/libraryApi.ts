import { apiGet } from './client';
import { getServerUrl } from './tokenManager';
import { BrowseListResponse, BookDetail, SeriesItem } from '../types/browse';

export interface BrowseParams {
  seriesId?: string;
  search?: string;
  searchBy?: 'all' | 'title' | 'author' | 'series';
  sortBy?: 'name' | 'recent' | 'sortOrder';
  offset?: number;
  limit?: number;
  format?: string;
}

export const libraryApi = {
  /**
   * Browse library items (series as folders, books as items)
   */
  browse: async (params?: BrowseParams): Promise<BrowseListResponse> => {
    const query = new URLSearchParams();
    if (params?.seriesId) query.set('seriesId', params.seriesId);
    if (params?.search && params.search.trim()) query.set('search', params.search.trim());
    if (params?.searchBy) query.set('searchBy', params.searchBy);
    if (params?.sortBy) query.set('sortBy', params.sortBy);
    if (params?.offset !== undefined) query.set('offset', String(params.offset));
    if (params?.limit !== undefined) query.set('limit', String(params.limit));
    query.set('format', params?.format || 'cfi');

    const qs = query.toString();
    const path = qs ? `/browse?${qs}` : '/browse';
    return apiGet<BrowseListResponse>(path);
  },

  /**
   * Get single book metadata and details (including series info and reading progress)
   */
  getBook: async (id: string, format: string = 'cfi'): Promise<BookDetail> => {
    const query = new URLSearchParams();
    if (format) query.set('format', format);
    const qs = query.toString();
    const path = qs ? `/books/${id}?${qs}` : `/books/${id}`;
    return apiGet<BookDetail>(path);
  },

  /**
   * Get list of series
   */
  getSeries: async (params?: { search?: string }): Promise<SeriesItem[]> => {
    const query = new URLSearchParams();
    if (params?.search) query.set('search', params.search);
    const qs = query.toString();
    const path = qs ? `/series?${qs}` : '/series';
    return apiGet<SeriesItem[]>(path);
  },

  /**
   * Get books inside a specific series
   */
  getSeriesBooks: async (seriesId: string): Promise<{ items: any[]; total: number }> => {
    return apiGet<{ items: any[]; total: number }>(`/series/${seriesId}/books?format=cfi`);
  },

  /**
   * Constructs the absolute URL for a book's cover image
   */
  getBookCoverUrl: (id: string): string => {
    const base = getServerUrl();
    if (!base) return '';
    return `${base.replace(/\/+$/, '')}/api/books/${id}/cover`;
  },
};
