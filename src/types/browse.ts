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
  title: string;
  author: string;
  coverUrl: string;
  description?: string | null;
  language?: string | null;
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

