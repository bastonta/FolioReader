import { apiDelete, apiGet, apiPost, apiPut } from './client';
import { getAccessToken, getServerUrl } from './tokenManager';
import type {
  BrowseListResponse,
  BookDetail,
  BooksListResponse,
  BookByHashResponse,
  SeriesItem,
  SeriesResponse,
  CreateSeriesRequest,
  UpdateSeriesRequest,
  DeleteSeriesResponse,
  AddBookToSeriesResponse,
  RemoveBookFromSeriesResponse,
  BrowseProgressInfo,
} from '../types/browse';

export interface BrowseParams {
  seriesId?: string;
  search?: string;
  searchBy?: 'all' | 'title' | 'author' | 'series' | string;
  sortBy?: 'name' | 'recent' | 'sortOrder' | string;
  offset?: number;
  limit?: number;
  format?: string;
}

export interface GetBooksParams {
  offset?: number;
  limit?: number;
  search?: string;
  query?: string;
  seriesId?: string;
  format?: string;
}

export interface BookmarkResponse {
  id: string;
  userId: string;
  bookId: string;
  location: string;
  title?: string | null;
  createdAt: string;
}

export interface CreateBookmarkPayload {
  location: string;
  title?: string | null;
}

export interface AnnotationResponse {
  id: string;
  userId: string;
  bookId: string;
  locationStart: string;
  locationEnd: string;
  selectedText: string;
  note?: string | null;
  color?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAnnotationPayload {
  locationStart: string;
  locationEnd: string;
  selectedText: string;
  note?: string | null;
  color?: string | null;
}

export interface UpdateAnnotationPayload {
  note?: string | null;
  color?: string | null;
}

export interface UpdateProgressPayload {
  location?: string | null;
  progressPercent?: number | null;
  isRead?: boolean | null;
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
   * List books with pagination and optional search or series filter
   */
  getBooks: async (params?: GetBooksParams): Promise<BooksListResponse> => {
    const query = new URLSearchParams();
    if (params?.offset !== undefined) query.set('offset', String(params.offset));
    if (params?.limit !== undefined) query.set('limit', String(params.limit));
    const term = params?.search || params?.query;
    if (term && term.trim()) query.set('search', term.trim());
    if (params?.seriesId) query.set('seriesId', params.seriesId);
    query.set('format', params?.format || 'cfi');

    const qs = query.toString();
    const path = qs ? `/books?${qs}` : '/books';
    return apiGet<BooksListResponse>(path);
  },

  /**
   * Get recently read books with active progress
   */
  getRecentBooks: async (params?: { limit?: number; format?: string }): Promise<BooksListResponse> => {
    const query = new URLSearchParams();
    if (params?.limit !== undefined) query.set('limit', String(params.limit));
    query.set('format', params?.format || 'cfi');

    const qs = query.toString();
    const path = qs ? `/books/recent?${qs}` : '/books/recent';
    return apiGet<BooksListResponse>(path);
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
   * Look up book by its SHA-256 file hash
   */
  getBookByHash: async (hash: string): Promise<BookByHashResponse> => {
    return apiGet<BookByHashResponse>(`/books/by-hash/${encodeURIComponent(hash)}`);
  },

  /**
   * Delete a book from the library
   */
  deleteBook: async (id: string): Promise<void> => {
    await apiDelete(`/books/${id}`);
  },

  /**
   * Constructs the absolute URL for a book's cover image
   */
  getBookCoverUrl: (id: string): string => {
    const base = getServerUrl();
    if (!base) return '';
    return `${base.replace(/\/+$/, '')}/api/books/${id}/cover`;
  },

  /**
   * Get direct download URL for a book
   */
  downloadBookUrl: (id: string): string => {
    const base = getServerUrl();
    if (!base) return '';
    const token = getAccessToken();
    return `${base.replace(/\/+$/, '')}/api/books/${id}/download${token ? `?token=${encodeURIComponent(token)}` : ''}`;
  },

  /**
   * Download book binary buffer
   */
  downloadBookBuffer: async (id: string): Promise<ArrayBuffer> => {
    const base = getServerUrl();
    if (!base) throw new Error('Server URL not configured');
    const token = getAccessToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${base.replace(/\/+$/, '')}/api/books/${id}/download`, {
      method: 'GET',
      headers,
    });
    if (!res.ok) {
      throw new Error(`Failed to download book: ${res.statusText}`);
    }
    return res.arrayBuffer();
  },

  // ── Series APIs ──────────────────────────────────────────────────────────

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
   * Create a new series
   */
  createSeries: async (data: CreateSeriesRequest): Promise<SeriesResponse> => {
    return apiPost<SeriesResponse>('/series', data);
  },

  /**
   * Update an existing series
   */
  updateSeries: async (id: string, data: UpdateSeriesRequest): Promise<SeriesResponse> => {
    return apiPut<SeriesResponse>(`/series/${id}`, data);
  },

  /**
   * Delete a series
   */
  deleteSeries: async (id: string): Promise<DeleteSeriesResponse> => {
    return apiDelete<DeleteSeriesResponse>(`/series/${id}`);
  },

  /**
   * Get books inside a specific series
   */
  getSeriesBooks: async (seriesId: string, format: string = 'cfi'): Promise<BooksListResponse> => {
    return apiGet<BooksListResponse>(`/series/${seriesId}/books?format=${encodeURIComponent(format)}`);
  },

  /**
   * Add a book to a series
   */
  addBookToSeries: async (
    seriesId: string,
    bookId: string,
    sortOrder?: number | null,
  ): Promise<AddBookToSeriesResponse> => {
    return apiPost<AddBookToSeriesResponse>(`/series/${seriesId}/books`, { bookId, sortOrder });
  },

  /**
   * Remove a book from a series
   */
  removeBookFromSeries: async (
    seriesId: string,
    bookId: string,
  ): Promise<RemoveBookFromSeriesResponse> => {
    return apiDelete<RemoveBookFromSeriesResponse>(`/series/${seriesId}/books/${bookId}`);
  },

  // ── Progress APIs ────────────────────────────────────────────────────────

  /**
   * Get reading progress for a book
   */
  getProgress: async (bookId: string, format: string = 'cfi'): Promise<BrowseProgressInfo | null> => {
    try {
      return await apiGet<BrowseProgressInfo>(`/books/${bookId}/progress?format=${encodeURIComponent(format)}`);
    } catch {
      return null;
    }
  },

  /**
   * Update reading progress for a book
   */
  updateProgress: async (
    bookId: string,
    payload: UpdateProgressPayload,
    format: string = 'cfi',
  ): Promise<BrowseProgressInfo> => {
    return apiPut<BrowseProgressInfo>(`/books/${bookId}/progress?format=${encodeURIComponent(format)}`, payload);
  },

  /**
   * Delete / reset reading progress for a book
   */
  deleteProgress: async (bookId: string): Promise<void> => {
    await apiDelete(`/books/${bookId}/progress`);
  },

  markAsRead: async (bookId: string, format: string = 'cfi'): Promise<BrowseProgressInfo> => {
    return libraryApi.updateProgress(bookId, { isRead: true, progressPercent: 100 }, format);
  },

  markAsUnread: async (bookId: string, format: string = 'cfi'): Promise<BrowseProgressInfo> => {
    return libraryApi.updateProgress(bookId, { isRead: false, progressPercent: 0 }, format);
  },

  resetProgress: async (bookId: string): Promise<void> => {
    return libraryApi.deleteProgress(bookId);
  },

  // ── Bookmark APIs ────────────────────────────────────────────────────────

  /**
   * List bookmarks for a book
   */
  getBookmarks: async (
    bookId: string,
    params?: { format?: string; since?: string },
  ): Promise<BookmarkResponse[]> => {
    const query = new URLSearchParams();
    query.set('format', params?.format || 'cfi');
    if (params?.since) query.set('since', params.since);
    return apiGet<BookmarkResponse[]>(`/books/${bookId}/bookmarks?${query.toString()}`);
  },

  /**
   * Create a bookmark for a book
   */
  createBookmark: async (
    bookId: string,
    location: string,
    title?: string | null,
    format: string = 'cfi',
  ): Promise<BookmarkResponse> => {
    return apiPost<BookmarkResponse>(`/books/${bookId}/bookmarks?format=${encodeURIComponent(format)}`, {
      location,
      title,
    });
  },

  /**
   * Delete a bookmark
   */
  deleteBookmark: async (bookId: string, bookmarkId: string): Promise<void> => {
    await apiDelete(`/books/${bookId}/bookmarks/${bookmarkId}`);
  },

  // ── Annotation APIs ──────────────────────────────────────────────────────

  /**
   * List annotations for a book
   */
  getAnnotations: async (
    bookId: string,
    params?: { format?: string; since?: string },
  ): Promise<AnnotationResponse[]> => {
    const query = new URLSearchParams();
    query.set('format', params?.format || 'cfi');
    if (params?.since) query.set('since', params.since);
    return apiGet<AnnotationResponse[]>(`/books/${bookId}/annotations?${query.toString()}`);
  },

  /**
   * Create an annotation
   */
  createAnnotation: async (
    bookId: string,
    payload: CreateAnnotationPayload,
    format: string = 'cfi',
  ): Promise<AnnotationResponse> => {
    return apiPost<AnnotationResponse>(`/books/${bookId}/annotations?format=${encodeURIComponent(format)}`, payload);
  },

  /**
   * Update an annotation
   */
  updateAnnotation: async (
    bookId: string,
    annotationId: string,
    payload: UpdateAnnotationPayload,
    format: string = 'cfi',
  ): Promise<AnnotationResponse> => {
    return apiPut<AnnotationResponse>(
      `/books/${bookId}/annotations/${annotationId}?format=${encodeURIComponent(format)}`,
      payload,
    );
  },

  /**
   * Delete an annotation
   */
  deleteAnnotation: async (bookId: string, annotationId: string): Promise<void> => {
    await apiDelete(`/books/${bookId}/annotations/${annotationId}`);
  },
};


