import { invoke } from '@tauri-apps/api/core';
import { Annotation, Bookmark, getAnnotationColorKey, BookReadingStats, ReadingSummary, DailyActivity } from '../types/reader';
import { getServerUrl, withFreshAccessToken } from '../api/tokenManager';
import { apiGet, apiPut, apiDelete, type ApiError } from '../api/client';
import { statisticsApi } from '../api/statisticsApi';
import { removeRecentBook, saveLastLocation } from './storage';
import { fileManager } from './fileManager';
import { parseCfiRange, toCfiRange } from '../utils/cfi';
import type { ChapterCopy } from '../types/browse';

export interface SyncResult {
  success: boolean;
  message: string;
  progressSynced: boolean;
  bookmarksSynced: number;
  annotationsSynced: number;
  sessionsSynced: number;
}

export interface PullProgressResult {
  success: boolean;
  message: string;
  location?: string;
  progressPercent?: number;
  isRead?: boolean;
  updatedAt?: string;
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

function errorText(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

// ================= BOOK MAPPINGS =================

/** Prefix of the `db_save_book_mapping` error for a local id bound to another server book. */
const MAPPING_CONFLICT_ERROR = 'MAPPING_CONFLICT';

/**
 * Records which server book a local file is (an empty `serverBookId` only
 * records the file). Returns `false` when nothing was recorded; in particular
 * the core never rebinds a local id that already belongs to another server
 * book, because its reading state would start syncing into that book.
 */
export async function saveDbBookMapping(
  localId: string,
  serverBookId: string,
  filePath?: string
): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    await invoke('db_save_book_mapping', {
      localId,
      serverBookId,
      filePath: filePath || null,
    });
    return true;
  } catch (err) {
    if (errorText(err).startsWith(MAPPING_CONFLICT_ERROR)) {
      console.warn(
        `'${localId}' belongs to another server book; not bound to ${serverBookId}`
      );
    } else {
      console.error('Failed to save book mapping:', err);
    }
    return false;
  }
}

/**
 * Local id of a book file. A file keeps the id it was first recorded under:
 * the id is derived from the path relative to the download folder, and that
 * folder may have been changed since, so it is computed from the path only
 * for a file that was never seen before.
 */
export async function getLocalBookIdForFile(
  filePath: string,
  baseDir?: string
): Promise<string> {
  if (isTauri()) {
    try {
      const recorded = await invoke<string | null>('db_get_local_id_for_file', { filePath });
      if (recorded) return recorded;
    } catch (err) {
      console.warn('Failed to look up the local id of a file:', err);
    }
  }
  return fileManager.getLocalBookId(filePath, baseDir);
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

export async function checkDownloadedServerBooks(
  serverBookIds: string[]
): Promise<Record<string, string>> {
  if (!isTauri() || !serverBookIds.length) return {};
  try {
    return await invoke<Record<string, string>>('db_check_downloaded_books', {
      serverBookIds,
    });
  } catch (err) {
    console.warn('Failed to check downloaded server books:', err);
    return {};
  }
}

/**
 * Local copies of `Chapters` books built on this device — the whole book and single
 * volumes, each a file of its own — by server book id. Only copies whose file is on disk.
 */
export async function getChapterCopies(
  serverBookIds: string[]
): Promise<Record<string, ChapterCopy[]>> {
  if (!isTauri() || !serverBookIds.length) return {};
  try {
    return await invoke<Record<string, ChapterCopy[]>>('db_get_chapter_copies', {
      serverBookIds,
    });
  } catch (err) {
    console.warn('Failed to list local copies of chapter books:', err);
    return {};
  }
}

/**
 * What a local book id holds of a `Chapters` book: the whole book or a single volume,
 * built on this device from the chapters. `null` for books downloaded as files.
 */
export async function getChapterCopy(bookId: string): Promise<ChapterCopy | null> {
  if (!isTauri()) return null;
  try {
    return (await invoke<ChapterCopy | null>('db_get_chapter_copy', { bookId })) ?? null;
  } catch (err) {
    console.warn('Failed to look up the chapter copy:', err);
    return null;
  }
}

/**
 * The volume copy a local book id stands for: a file that holds a single volume of a
 * `Chapters` book. `null` for the whole book and for books downloaded as files.
 */
async function getVolumeCopy(bookId: string): Promise<ChapterCopy | null> {
  const copy = await getChapterCopy(bookId);
  return copy && copy.volume !== null && copy.volume !== undefined ? copy : null;
}

/**
 * Where the reading position the server keeps for the book is, seen from a volume copy.
 * The server has one position per book, shared by all of its volumes: `inside` this
 * copy, `elsewhere` (another volume, or a chapter the copy does not have), `none` (the
 * server has no position), or `unknown` when the server could not be asked.
 */
async function locateServerPosition(
  copy: ChapterCopy
): Promise<'inside' | 'elsewhere' | 'none' | 'unknown'> {
  let location: string | null | undefined;
  try {
    const remote = await apiGet<{ location?: string | null }>(
      `/books/${copy.serverBookId}/progress`
    );
    location = remote?.location;
  } catch (err) {
    return (err as ApiError | null)?.status === 404 ? 'none' : 'unknown';
  }
  // An empty location means "no position"
  if (!location || !location.trim()) return 'none';
  if (!location.startsWith('ch:')) return 'elsewhere';
  try {
    const position = await invoke<number | null>('db_get_chapter_position', {
      bookId: copy.localId,
      chapterId: location.slice(3),
    });
    return position !== null && position !== undefined ? 'inside' : 'elsewhere';
  } catch {
    return 'unknown';
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

export async function deleteDbProgress(bookId: string): Promise<void> {
  if (!isTauri()) return;

  try {
    await invoke('db_delete_progress', { bookId });
  } catch (err) {
    console.error('Failed to delete progress from SQLite:', err);
  }
}

function isUuid(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

/**
 * Resets book progress locally and optionally on the server (defaults to true).
 */
export async function resetBookProgress(bookId: string, resetOnServer: boolean = true): Promise<void> {
  // 1. Reset on server if requested
  if (resetOnServer) {
    try {
      let serverBookId: string | null = null;
      if (isUuid(bookId)) {
        serverBookId = bookId;
      } else {
        serverBookId = await getDbServerBookId(bookId);
      }

      // The server keeps one position per book. Resetting a single volume must not wipe
      // a position that is in another volume.
      const volumeCopy = await getVolumeCopy(bookId);
      const ownsServerPosition = volumeCopy
        ? (await locateServerPosition(volumeCopy)) === 'inside'
        : true;

      if (serverBookId && !serverBookId.startsWith('local-') && ownsServerPosition) {
        await apiDelete(`/books/${serverBookId}/progress`);
      }
    } catch (err) {
      console.warn(`Failed to reset progress on server for book ${bookId}:`, err);
    }
  }

  // 2. Delete from SQLite
  await deleteDbProgress(bookId);

  // 3. Remove from recent books (both memory and SQLite)
  await removeRecentBook(bookId, false);
}

/**
 * Sets book read status (marked as read: 100% / isRead: true; unread: 0% / isRead: false).
 *
 * The mark is stored by the core and reaches the server through the regular sync, which
 * knows how to send it for every kind of book (a file, a copy built from chapters, a
 * single volume). No position is invented for it: a book marked read keeps the position
 * it has, a book marked unread has none.
 */
export async function setBookReadStatus(bookId: string, isRead: boolean): Promise<void> {
  const fraction = isRead ? 1.0 : 0.0;

  if (!isTauri()) {
    // Browser preview: there is no local database, only the server
    try {
      if (isUuid(bookId)) {
        await apiPut(`/books/${bookId}/progress?format=cfi`, {
          progressPercent: isRead ? 100.0 : 0.0,
          isRead,
        });
      }
    } catch (err) {
      console.warn(`Failed to update read status on server for book ${bookId}:`, err);
    }
    return;
  }

  // A single volume of a book: the state is stored at the end (or the start) of this
  // file and the sync translates it into the scale of the whole book. Finishing a volume
  // does not finish the book, and marking a volume unread must not clear the book's
  // read flag.
  let location: string | null = null;
  let markPending = true;
  const volumeCopy = await getVolumeCopy(bookId);
  if (volumeCopy) {
    const lastChapter = Math.max(1, volumeCopy.chaptersCount);
    location = `epubcfi(/6/${isRead ? lastChapter * 2 : 2}!/4)`;
    // The server keeps one position for the whole book. When it is in another volume
    // (or cannot be asked now), the mark of this volume stays on this device: sending it
    // would move the position of the book into this volume.
    const serverPosition = await locateServerPosition(volumeCopy);
    markPending = serverPosition === 'inside' || serverPosition === 'none';
  }

  try {
    const saved = await invoke<DbBookProgress>('db_set_read_status', {
      bookId,
      isRead,
      location,
      markPending,
    });
    saveLastLocation(bookId, saved.location, fraction);
  } catch (err) {
    console.error('Failed to save read status to SQLite:', err);
    return;
  }

  if (markPending) {
    await syncBookData(bookId);
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
  bookId: string,
  annotationIdOrValue: string
): Promise<void> {
  if (!isTauri()) return;

  try {
    // The same CFI range exists in many books: the deletion is limited to this one
    await invoke('db_delete_annotation', {
      idOrValue: annotationIdOrValue,
      bookId: bookId || null,
    });
  } catch (err) {
    console.error('Failed to delete annotation from SQLite:', err);
  }
}

// ================= SYNC API =================

/**
 * Exchanges the reading position of a book with the server.
 *
 * Inside the application this is done by the core only: it compares the change
 * times of the local and the server position, never overwrites a local
 * position that is newer (or that changed while the server was being asked)
 * and translates positions of copies built from chapters. `location` is set
 * only when the server position won and the reader has to move there.
 * A failed request leaves the local position alone.
 */
export async function pullBookProgress(bookId: string): Promise<PullProgressResult | null> {
  const serverUrl = getServerUrl();
  if (!serverUrl) return null;

  if (isTauri()) {
    try {
      return await withFreshAccessToken((token) =>
        invoke<PullProgressResult>('pull_book_progress', {
          bookId,
          serverUrl,
          token,
        })
      );
    } catch (err) {
      console.warn(`Pull progress failed for ${bookId}:`, err);
      return {
        success: false,
        message: errorText(err) || 'Failed to fetch progress from server',
      };
    }
  }

  // Browser preview (no core, no local database): the server position is all
  // there is. Nothing is stored here.
  try {
    if (!isUuid(bookId)) {
      return {
        success: false,
        message: 'Book is not mapped to server ID',
      };
    }

    const res = await apiGet<{
      location?: string | null;
      progressPercent?: number;
      isRead?: boolean;
      updatedAt?: string;
    }>(`/books/${bookId}/progress?format=cfi`);

    // An empty location means "no position": there is nowhere to go
    if (res && res.location && res.location.trim()) {
      return {
        success: true,
        message: 'Progress successfully fetched from server',
        location: res.location,
        progressPercent: res.progressPercent || 0,
        isRead: res.isRead,
        updatedAt: res.updatedAt,
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

    const result = await withFreshAccessToken((token) =>
      invoke<SyncResult>('sync_book_data', {
        bookId,
        serverUrl,
        token,
      })
    );
    if (result && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('folio:sync-completed', { detail: { bookId, result } }));
    }
    return result;
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

    const results = await withFreshAccessToken((token) =>
      invoke<SyncResult[]>('sync_all_pending', {
        serverUrl,
        token,
      })
    );
    if (results && results.length > 0 && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('folio:sync-completed', { detail: { results } }));
    }
    return results;
  } catch (err) {
    console.warn('Sync all pending failed:', err);
    return [];
  }
}

export async function clearDbAllData(): Promise<void> {
  if (!isTauri()) return;

  try {
    await invoke('db_clear_all_data');
  } catch (err) {
    console.error('Failed to clear SQLite database:', err);
  }
}

// ================= READING SESSIONS & STATISTICS =================

export async function saveDbReadingSession(
  bookId: string,
  durationSeconds: number,
  startTime: string,
  endTime: string,
  startProgress?: number,
  endProgress?: number,
  pagesRead: number = 0,
  deviceName: string = 'FolioReader'
): Promise<void> {
  if (!isTauri()) return;
  if (durationSeconds < 10) return; // Ignore accidental opens under 10 seconds

  const clampProgress = (val?: number | null): number | null => {
    if (val === undefined || val === null || isNaN(val)) return null;
    return Math.min(100.0, Math.max(0.0, val * 100.0));
  };

  try {
    await invoke('db_save_reading_session', {
      bookId,
      deviceName,
      startTime,
      endTime,
      durationSeconds: Math.floor(durationSeconds),
      startProgress: clampProgress(startProgress),
      endProgress: clampProgress(endProgress),
      pagesRead,
    });
  } catch (err) {
    console.error('Failed to save reading session to SQLite:', err);
  }
}

export async function getDbBookReadingStats(bookId: string): Promise<BookReadingStats | null> {
  if (!isTauri()) return null;

  try {
    const stats = await invoke<BookReadingStats>('db_get_book_reading_stats', { bookId });
    return stats;
  } catch (err) {
    console.warn('Failed to get book reading stats from SQLite:', err);
    return null;
  }
}

export async function fetchServerBookStatistics(bookId: string): Promise<BookReadingStats | null> {
  try {
    let serverBookId: string | null = null;
    if (isUuid(bookId)) {
      serverBookId = bookId;
    } else {
      serverBookId = await getDbServerBookId(bookId);
    }

    if (!serverBookId || serverBookId.startsWith('local-')) {
      return await getDbBookReadingStats(bookId);
    }

    return await statisticsApi.getBookStatistics(serverBookId);
  } catch (err) {
    console.warn(`Failed to fetch server statistics for book ${bookId}:`, err);
    return await getDbBookReadingStats(bookId);
  }
}

export async function deleteBookStatistics(bookId: string): Promise<void> {
  // 1. Delete from SQLite
  if (isTauri()) {
    try {
      await invoke('db_delete_book_reading_stats', { bookId });
    } catch (err) {
      console.warn('Failed to delete book reading stats from SQLite:', err);
    }
  }

  // 2. Delete from server if connected
  try {
    let serverBookId: string | null = null;
    if (isUuid(bookId)) {
      serverBookId = bookId;
    } else {
      serverBookId = await getDbServerBookId(bookId);
    }

    if (serverBookId && !serverBookId.startsWith('local-')) {
      await statisticsApi.deleteBookStatistics(serverBookId);
    }
  } catch (err) {
    console.warn(`Failed to delete reading stats on server for book ${bookId}:`, err);
  }
}

export async function fetchServerReadingSummary(): Promise<ReadingSummary | null> {
  try {
    return await statisticsApi.getSummary();
  } catch (err) {
    console.warn('Failed to fetch reading summary from server:', err);
    return null;
  }
}

export async function fetchServerReadingActivity(
  from?: string,
  to?: string
): Promise<DailyActivity[]> {
  try {
    const res = await statisticsApi.getActivity({ from, to });
    return res || [];
  } catch (err) {
    console.warn('Failed to fetch reading activity from server:', err);
    return [];
  }
}


