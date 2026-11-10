/**
 * Book representation on the Folio server.
 * - `File` — a complete EPUB file stored in the library (downloaded as is).
 * - `Chapters` — a book assembled from chapters on the server; it has no file
 *   (`/download` answers 409), so the reader downloads its chapters and builds
 *   a local EPUB copy that can be updated when new chapters appear.
 */
export type BookKind = 'File' | 'Chapters';

/** Stage of building a local copy of a `Chapters` book. */
export type ChaptersDownloadPhase = 'chapters' | 'images' | 'building';

/** Progress event emitted by the `download_chapters_book` command. */
export interface ChaptersDownloadProgress {
  phase: ChaptersDownloadPhase;
  done: number;
  total: number;
}

/** Result of the `download_chapters_book` command. */
export interface ChaptersBookDownloadResult {
  /** Absolute path of the EPUB built from the chapters */
  filePath: string;
  /** Local library id of that file */
  localId: string;
  /** Chapters in the book after this run */
  chaptersTotal: number;
  /** Chapters downloaded in this run (new or changed since the previous build) */
  chaptersFetched: number;
  imagesFetched: number;
  /** Illustrations the server could not provide */
  imagesMissing: number;
  /** Reading position (EPUB CFI) restored from the server progress on a first download */
  location?: string | null;
  /** `true` when an existing local copy was updated rather than created */
  updated: boolean;
}

export interface BrowseProgressInfo {
  location: string;
  progressPercent: number;
  isRead?: boolean;
  updatedAt?: string;
}

export type ProgressInfo = BrowseProgressInfo;

export interface PreviouslyDeletedInfo {
  title: string;
  author: string;
  deletedAt: string;
}

export interface BookSeriesItemResponse {
  id: string;
  name: string;
  parentId?: string | null;
  sortOrder?: number | null;
}

export interface BookResponseItem {
  id: string;
  kind: BookKind;
  title: string;
  author: string;
  coverUrl: string;
  seriesOrder?: number | null;
  progress?: BrowseProgressInfo | null;
}

export interface BooksListResponse {
  items: BookResponseItem[];
  total: number;
  offset: number;
  limit: number;
}

export interface BookByHashResponse {
  id: string;
  title: string;
  author: string;
  coverUrl: string;
  description?: string | null;
  language?: string | null;
  seriesOrder?: number | null;
  series: BookSeriesItemResponse[];
}

export interface BrowseItem {
  id: string;
  name: string;
  type: 'book' | 'series' | string;
  /** Book kind; absent for series items */
  kind?: BookKind | null;
  author?: string | null;
  coverUrl?: string | null;
  sortOrder?: number | null;
  progress?: BrowseProgressInfo | null;
  createdAt: string;
}

export type BrowseItemResponse = BrowseItem;

export interface BrowseListResponse {
  items: BrowseItem[];
  total: number;
  offset: number;
  limit: number;
}

export interface SeriesItem {
  id: string;
  name: string;
  parentId?: string | null;
  bookCount: number;
}

export type SeriesResponse = SeriesItem;

export interface CreateSeriesRequest {
  name: string;
  parentId?: string | null;
}

export interface UpdateSeriesRequest {
  name: string;
  parentId?: string | null;
}

export interface DeleteSeriesResponse {
  success: boolean;
}

export interface AddBookToSeriesRequest {
  bookId: string;
  sortOrder?: number | null;
}

export interface AddBookToSeriesResponse {
  bookId: string;
  seriesId: string;
  sortOrder?: number | null;
}

export interface RemoveBookFromSeriesResponse {
  success: boolean;
}

export interface BookDetail {
  id: string;
  kind: BookKind;
  title: string;
  author: string;
  coverUrl: string;
  description?: string | null;
  language?: string | null;
  /** Book this one was derived from (translation or compiled copy) */
  originBookId?: string | null;
  /** Number of stored chapters (only for `Chapters` kind) */
  chaptersCount?: number | null;
  seriesOrder?: number | null;
  progress?: BrowseProgressInfo | null;
  series: BookSeriesItemResponse[];
  previouslyDeleted?: PreviouslyDeletedInfo | null;
}

export type BookResponse = BookDetail;

export interface LocalBookFile {
  id: string;
  filePath: string;
  fileName: string;
  relativePath: string;
  folderName?: string;
  fileSize: number;
  modifiedAt?: string;
}

export interface LocalBookMetadata {
  id: string;
  title: string;
  author: string;
  coverUrl?: string;
  folderName?: string;
  seriesName?: string;
}

