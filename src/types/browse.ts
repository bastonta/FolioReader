export interface BrowseProgressInfo {
  location?: string;
  progressPercent?: number;
  isRead?: boolean;
  updatedAt?: string;
}

export interface BrowseItem {
  id: string;
  name: string;
  type: 'book' | 'series';
  author?: string;
  coverUrl?: string;
  sortOrder?: number;
  progress?: BrowseProgressInfo;
  createdAt: string;
}

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
  bookCount?: number;
}

export interface BookDetail {
  id: string;
  title: string;
  author: string;
  description?: string;
  language?: string;
  coverUrl: string;
  seriesOrder?: number;
  progress?: BrowseProgressInfo;
  series: Array<{
    id: string;
    name: string;
    parentId?: string | null;
    sortOrder?: number;
  }>;
}

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
