import { invoke } from '@tauri-apps/api/core';
import { Annotation, Bookmark, getAnnotationColorKey } from '../types/reader';
import { getServerUrl, getAccessToken } from '../api/tokenManager';
import { apiGet } from '../api/client';
import { parseCfiRange, toCfiRange } from '../utils/cfi';

export interface SyncResult {
  success: boolean;
  message: string;
  progressSynced: boolean;
  bookmarksSynced: number;
  annotationsSynced: number;
}

export interface PullProgressResult {
  success: boolean;
  message: string;
  location?: string;
  progressPercent?: number;
  isRead?: boolean;
}

interface DbBookProgress {
  bookId: string;
  location: string;
  progressPercent: number;
  isRead: boolean;
  updatedAt: string;
  syncStatus: string;
}

interface DbBookmark {
  id: string;
  serverId?: string;
  bookId: string;
  location: string;
  fraction: number;
  locationLabel?: string;
  chapterTitle?: string;
  createdAt: string;
  isDeleted: boolean;
  syncStatus: string;
}

interface DbAnnotation {
  id: string;
  serverId?: string;
  bookId: string;
  locationStart: string;
  locationEnd: string;
  value: string;
  selectedText: string;
  note?: string;
  color: string;
  style?: string;
  chapterTitle?: string;
  sectionIndex?: number;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
  syncStatus: string;
}

const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

// ================= BOOK MAPPINGS =================

export async function saveDbBookMapping(
  localId: string,
  serverBookId: string,
  filePath?: string
): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('db_save_book_mapping', {
      localId,
      serverBookId,
      filePath: filePath || null,
    });
  } catch (err) {
    console.error('Failed to save book mapping:', err);
  }
}

export async function getDbServerBookId(bookId: string): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string | null>('db_get_server_book_id', { bookId });
  } catch (err) {
    console.warn('Failed to get server book id:', err);
    return null;
  }
}

// ================= PROGRESS =================

export async function loadDbLastLocation(
  bookId: string
): Promise<{ cfi?: string; fraction?: number; isRead?: boolean } | null> {
  if (!isTauri()) return null;

  try {
    const res = await invoke<DbBookProgress | null>('db_get_progress', { bookId });
    if (!res) return null;
    return {
      cfi: res.location,
      fraction: res.progressPercent / 100.0,
      isRead: res.isRead,
    };
  } catch (err) {
    console.error('Failed to load progress from SQLite:', err);
    return null;
  }
}

export async function saveDbLastLocation(
  bookId: string,
  cfi: string,
  fraction: number,
  isRead: boolean = false
): Promise<void> {
  if (!isTauri()) return;

  try {
    const progressPercent = Math.min(100.0, Math.max(0.0, fraction * 100.0));
    await invoke('db_save_progress', {
      bookId,
      location: cfi,
      progressPercent,
      isRead,
    });
  } catch (err) {
    console.error('Failed to save progress to SQLite:', err);
  }
}

// ================= BOOKMARKS =================

export async function loadDbBookmarks(bookId: string): Promise<Bookmark[]> {
  if (!isTauri()) return [];

  try {
    const res = await invoke<DbBookmark[]>('db_get_bookmarks', { bookId });
    return res.map((bm) => ({
      id: bm.id,
      bookId: bm.bookId,
      cfi: bm.location,
      fraction: bm.fraction,
      locationLabel: bm.locationLabel,
      chapterTitle: bm.chapterTitle,
      createdAt: bm.createdAt,
    }));
  } catch (err) {
    console.error('Failed to load bookmarks from SQLite:', err);
    return [];
  }
}

export async function saveDbBookmark(bookmark: Bookmark): Promise<void> {
  if (!isTauri()) return;

  try {
    await invoke('db_save_bookmark', {
      id: bookmark.id,
      bookId: bookmark.bookId,
      location: bookmark.cfi,
      fraction: bookmark.fraction,
      locationLabel: bookmark.locationLabel || null,
      chapterTitle: bookmark.chapterTitle || null,
    });
  } catch (err) {
    console.error('Failed to save bookmark to SQLite:', err);
  }
}

export async function deleteDbBookmark(_bookId: string, bookmarkId: string): Promise<void> {
  if (!isTauri()) return;

  try {
    await invoke('db_delete_bookmark', { id: bookmarkId });
  } catch (err) {
    console.error('Failed to delete bookmark from SQLite:', err);
  }
}

// ================= ANNOTATIONS =================

export async function loadDbAnnotations(bookId: string): Promise<Annotation[]> {
  if (!isTauri()) return [];

  try {
    const res = await invoke<DbAnnotation[]>('db_get_annotations', { bookId });
    return res.map((ann) => {
      const cfiRange = toCfiRange(ann.locationStart, ann.locationEnd);
      return {
        id: ann.id,
        bookId: ann.bookId,
        value: cfiRange || ann.value,
        color: getAnnotationColorKey(ann.color),
        style: (ann.style as any) || 'highlight',
        text: ann.selectedText,
        note: ann.note,
        createdAt: ann.createdAt,
        chapterTitle: ann.chapterTitle,
        sectionIndex: ann.sectionIndex,
      };
    });
  } catch (err) {
    console.error('Failed to load annotations from SQLite:', err);
    return [];
  }
}

export async function saveDbAnnotation(annotation: Annotation): Promise<void> {
  if (!isTauri()) return;
  const { locationStart, locationEnd } = parseCfiRange(annotation.value);
  const colorKey = getAnnotationColorKey(annotation.color);

  try {
    await invoke('db_save_annotation', {
      id: annotation.id,
      bookId: annotation.bookId,
      locationStart: locationStart || annotation.value,
      locationEnd: locationEnd || annotation.value,
      value: annotation.value,
      selectedText: annotation.text,
      note: annotation.note || null,
      color: colorKey,
      style: annotation.style || 'highlight',
      chapterTitle: annotation.chapterTitle || null,
      sectionIndex: annotation.sectionIndex ?? null,
    });
  } catch (err) {
    console.error('Failed to save annotation to SQLite:', err);
  }
}

export async function deleteDbAnnotation(
  _bookId: string,
  annotationIdOrValue: string
): Promise<void> {
  if (!isTauri()) return;

  try {
    await invoke('db_delete_annotation', { idOrValue: annotationIdOrValue });
  } catch (err) {
    console.error('Failed to delete annotation from SQLite:', err);
  }
}

// ================= SYNC API =================

export async function pullBookProgress(bookId: string): Promise<PullProgressResult | null> {
  const serverUrl = getServerUrl();
  if (!serverUrl) return null;
  const token = getAccessToken();

  if (isTauri()) {
    try {
      const res = await invoke<PullProgressResult>('pull_book_progress', {
        bookId,
        serverUrl,
        token: token || null,
      });
      return res;
    } catch (err) {
      console.warn(`Pull progress invoke failed for ${bookId}:`, err);
    }
  }

  // Fallback for Web/WebView or direct REST
  try {
    const serverBookId = (await getDbServerBookId(bookId)) || bookId;
    if (!serverBookId || serverBookId.startsWith('local-')) {
      return {
        success: false,
        message: 'Book is not mapped to server ID',
      };
    }

    const res = await apiGet<{ location?: string; progressPercent?: number; isRead?: boolean }>(
      `/books/${serverBookId}/progress?format=cfi`
    );

    if (res && res.location) {
      const percent = res.progressPercent || 0;
      await saveDbLastLocation(bookId, res.location, percent / 100, res.isRead || false);
      return {
        success: true,
        message: 'Progress successfully fetched from server',
        location: res.location,
        progressPercent: percent,
        isRead: res.isRead,
      };
    }

    return {
      success: false,
      message: 'No progress found on server',
    };
  } catch (err: any) {
    console.warn(`Pull progress API failed for ${bookId}:`, err);
    return {
      success: false,
      message: err?.message || 'Failed to fetch progress from server',
    };
  }
}

export async function syncBookData(bookId: string): Promise<SyncResult | null> {
  if (!isTauri()) return null;

  try {
    const serverUrl = getServerUrl();
    if (!serverUrl) return null;
    const token = getAccessToken();

    return await invoke<SyncResult>('sync_book_data', {
      bookId,
      serverUrl,
      token: token || null,
    });
  } catch (err) {
    console.warn(`Sync failed for book ${bookId}:`, err);
    return null;
  }
}

export async function syncAllPending(): Promise<SyncResult[]> {
  if (!isTauri()) return [];

  try {
    const serverUrl = getServerUrl();
    if (!serverUrl) return [];
    const token = getAccessToken();

    return await invoke<SyncResult[]>('sync_all_pending', {
      serverUrl,
      token: token || null,
    });
  } catch (err) {
    console.warn('Sync all pending failed:', err);
    return [];
  }
}
