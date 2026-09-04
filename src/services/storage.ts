import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { ReaderSettings, RecentBook } from '../types/reader';
import { clearDbAllData } from './readerDb';
import { clearTokens, getServerUrl } from '../api/tokenManager';
import { fileManager } from './fileManager';

const SETTINGS_KEY = 'foliate_reader_settings';
const THEME_KEY = 'folio_theme';

export const DEFAULT_SETTINGS: ReaderSettings = {
  flow: 'paginated',
  columns: 'auto',
  fontFamily: 'Georgia, serif',
  fontSize: 18,
  fontWeight: 400,
  spacing: 1.5,
  margin: 48,
  justify: true,
  hyphenate: true,
  theme: 'light',
  language: 'system',
  pageTurnMethod: 'both',
  volumeKeysPageTurn: true,
  volumeKeysInverted: false,
  screenTimeout: '5',
  sidebarPinned: false,
  sidebarOpen: false,
  activeTab: 'contents',
  downloadPath: '',
  createSeriesFolder: true,
  libraryViewMode: 'grid',
  autoCheckUpdates: true,
  includePrereleases: false,
  footerDisplayMode: 'pages',
};

const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

// ─── In-Memory Synchronous Caches ──────────────────────────────────────────
let cachedSettings: ReaderSettings = (() => {
  try {
    if (typeof localStorage !== 'undefined') {
      const data = localStorage.getItem(SETTINGS_KEY);
      if (data) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
      }
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_SETTINGS };
})();

let cachedRecentBooks: RecentBook[] = [];
let cachedLocalMeta: Record<string, LocalBookCacheItem> = {};
let isStorageInitialized = false;

// ─── Legacy IndexedDB Cleanup Helper ───────────────────────────────────────

export async function clearIndexedDb(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;

  try {
    if (typeof (indexedDB as any).databases === 'function') {
      const dbs = await (indexedDB as any).databases();
      if (Array.isArray(dbs) && dbs.length > 0) {
        await Promise.all(
          dbs.map((dbInfo: any) => {
            if (dbInfo && dbInfo.name) {
              return new Promise<void>((resolve) => {
                const req = indexedDB.deleteDatabase(dbInfo.name);
                req.onsuccess = () => resolve();
                req.onerror = () => resolve();
                req.onblocked = () => resolve();
              });
            }
            return Promise.resolve();
          })
        );
      }
    }
  } catch (e) {
    console.warn('Error deleting databases via indexedDB.databases():', e);
  }

  return new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('FolioBookDB');
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

// ─── All User Data Reset ───────────────────────────────────────────────────

export async function clearAllUserData(
  options: { preserveServerUrl?: boolean } = {}
): Promise<void> {
  const { preserveServerUrl = true } = options;
  const currentServerUrl = preserveServerUrl
    ? (typeof localStorage !== 'undefined' ? localStorage.getItem('folio_server_url') : null) || getServerUrl()
    : null;

  // 1. Clear SQLite database
  try {
    await clearDbAllData();
  } catch (err) {
    console.error('Failed to clear SQLite DB:', err);
  }

  // 2. Clear covers folder cache
  try {
    await fileManager.clearCoversCache();
  } catch (err) {
    console.error('Failed to clear covers cache:', err);
  }

  // 3. Reset settings.json to defaults
  try {
    await fileManager.saveAppSettings(JSON.stringify(DEFAULT_SETTINGS, null, 2));
  } catch (err) {
    console.error('Failed to reset settings.json:', err);
  }

  // 4. Clear legacy IndexedDB if exists
  try {
    await clearIndexedDb();
  } catch (err) {
    console.error('Failed to clear IndexedDB:', err);
  }

  // 5. Clear localStorage (preserving server URL if requested)
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
      if (preserveServerUrl && currentServerUrl) {
        localStorage.setItem('folio_server_url', currentServerUrl);
      }
    }
  } catch (err) {
    console.error('Failed to clear localStorage:', err);
  }

  // 6. Reset in-memory caches
  cachedSettings = { ...DEFAULT_SETTINGS };
  cachedRecentBooks = [];
  cachedLocalMeta = {};

  // 7. Clear memory tokens & cookies
  clearTokens();
}

// ─── Book Covers Management (File System) ──────────────────────────────────

/**
 * Saves book cover to file system (`covers/{bookId}.jpg`) and returns web-accessible asset URL.
 */
export async function storeBookCover(id: string, coverBlobOrBase64: Blob | string): Promise<string> {
  if (!isTauri()) {
    if (typeof coverBlobOrBase64 === 'string') return coverBlobOrBase64;
    return URL.createObjectURL(coverBlobOrBase64);
  }

  try {
    const filePath = await fileManager.saveBookCover(id, coverBlobOrBase64);
    return convertFileSrc(filePath);
  } catch (err) {
    console.error('Failed to store cover file in disk cache:', err);
    if (typeof coverBlobOrBase64 === 'string') return coverBlobOrBase64;
    return URL.createObjectURL(coverBlobOrBase64);
  }
}

/**
 * Returns the asset URL for a book's stored cover file if it exists.
 */
export async function loadBookCover(id: string): Promise<string | null> {
  if (!isTauri()) return null;

  try {
    const filePath = await fileManager.getBookCoverPath(id);
    if (filePath) {
      return convertFileSrc(filePath);
    }
    return null;
  } catch (err) {
    console.error('Failed to load cover file path from disk:', err);
    return null;
  }
}

/**
 * Deletes a book cover file from disk cache.
 */
export async function deleteBookCover(id: string): Promise<void> {
  if (!isTauri()) return;

  try {
    await fileManager.deleteBookCover(id);
  } catch (err) {
    console.error('Failed to delete cover file from disk:', err);
  }
}

/**
 * Helper to convert a blob to thumbnail data URL when needed for inline canvas processing.
 */
export async function blobToThumbnailDataUrl(
  blob: Blob,
  maxWidth = 300,
  maxHeight = 450
): Promise<string> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          const width = img.naturalWidth || img.width;
          const height = img.naturalHeight || img.height;
          if (!width || !height) {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => resolve('');
            reader.readAsDataURL(blob);
            return;
          }

          const scale = Math.min(maxWidth / width, maxHeight / height, 1);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
            resolve(dataUrl);
          } else {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => resolve('');
            reader.readAsDataURL(blob);
          }
        } catch {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => resolve('');
          reader.readAsDataURL(blob);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => resolve('');
        reader.readAsDataURL(blob);
      };
      img.src = url;
    } catch {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    }
  });
}

export const formatLanguageMap = (x: any): string => {
  if (!x) return '';
  if (typeof x === 'string') return x;
  if (typeof x === 'number' || typeof x === 'boolean') return String(x);
  if (Array.isArray(x)) {
    return x.map((item) => formatLanguageMap(item)).filter(Boolean).join(', ');
  }
  if (typeof x === 'object') {
    if ('name' in x && x.name) {
      return formatLanguageMap(x.name);
    }
    const keys = Object.keys(x);
    if (keys.length === 0) return '';
    const val = x[keys[0]];
    return typeof val === 'string' ? val : formatLanguageMap(val);
  }
  return String(x);
};

export const formatContributor = (contributor: any): string => {
  if (!contributor) return '';
  if (typeof contributor === 'string') return contributor;
  if (Array.isArray(contributor)) {
    return contributor
      .map((c) => formatContributor(c))
      .filter(Boolean)
      .join(', ');
  }
  if (typeof contributor === 'object') {
    if ('name' in contributor && contributor.name) {
      return formatContributor(contributor.name);
    }
    return formatLanguageMap(contributor);
  }
  return String(contributor);
};

export const parseSubjects = (subject?: any): string[] => {
  if (!subject) return [];
  const rawList = Array.isArray(subject) ? subject : [subject];
  const results: string[] = [];

  for (const item of rawList) {
    if (!item) continue;
    let str = '';
    if (typeof item === 'string') {
      str = item;
    } else if (typeof item === 'object') {
      str = formatContributor(item);
    } else {
      str = String(item);
    }
    if (str) {
      const parts = str
        .split(/[,;|]/)
        .map((s) => s.trim().replace(/_/g, ' '))
        .filter(Boolean);
      results.push(...parts);
    }
  }

  return Array.from(new Set(results));
};

// ─── Settings (settings.json + Lightweight LocalStorage Mirror for FOUC) ────

export function loadSettings(): ReaderSettings {
  return cachedSettings;
}

export async function loadSettingsAsync(): Promise<ReaderSettings> {
  if (isTauri()) {
    try {
      const raw = await fileManager.loadAppSettings();
      if (raw) {
        const parsed = JSON.parse(raw);
        cachedSettings = { ...DEFAULT_SETTINGS, ...parsed };
        if (!cachedSettings.sidebarPinned) {
          cachedSettings.sidebarOpen = false;
        }

        // Mirror light settings to localStorage for index.html theme preload
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(cachedSettings));
            localStorage.setItem(THEME_KEY, cachedSettings.theme || 'light');
          }
        } catch {}

        return cachedSettings;
      }
    } catch (err) {
      console.warn('Failed to load settings.json async:', err);
    }
  }

  return cachedSettings;
}

export function saveSettings(settings: Partial<ReaderSettings>): ReaderSettings {
  const updated: ReaderSettings = { ...cachedSettings, ...settings };
  cachedSettings = updated;

  // 1. Write to settings.json asynchronously via Tauri FS
  if (isTauri()) {
    fileManager.saveAppSettings(JSON.stringify(updated, null, 2)).catch((err) => {
      console.error('Failed to save settings.json:', err);
    });
  }

  // 2. Keep lightweight localStorage in sync for instant startup in index.html
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
      localStorage.setItem(THEME_KEY, updated.theme || 'light');
    }
  } catch {
    // ignore
  }

  return updated;
}

// ─── Recent Books (SQLite) ─────────────────────────────────────────────────

export interface DbRecentBookRow {
  id: string;
  title: string;
  author: string;
  coverPath?: string;
  coverUrl?: string;
  filePath?: string;
  fileName?: string;
  fileSize?: number;
  lastLocation?: string;
  progressFraction: number;
  lastOpenedAt: string;
}

export function loadRecentBooks(): RecentBook[] {
  return cachedRecentBooks;
}

export async function loadRecentBooksAsync(): Promise<RecentBook[]> {
  if (!isTauri()) return cachedRecentBooks;

  try {
    const rows = await invoke<DbRecentBookRow[]>('db_get_recent_books', { limit: 100 });
    const books: RecentBook[] = await Promise.all(
      rows.map(async (r) => {
        let coverUrl: string | undefined;
        let diskPath = r.coverPath;
        if (!diskPath) {
          diskPath = (await fileManager.getBookCoverPath(r.id)) || undefined;
        }
        if (diskPath) {
          coverUrl = convertFileSrc(diskPath);
        } else if (r.coverUrl && !r.coverUrl.startsWith('asset://') && !r.coverUrl.startsWith('http://asset.localhost')) {
          coverUrl = r.coverUrl;
        }

        return {
          id: r.id,
          title: r.title,
          author: r.author,
          coverUrl,
          filePath: r.filePath,
          fileName: r.fileName,
          fileSize: r.fileSize,
          lastLocation: r.lastLocation,
          progressFraction: r.progressFraction,
          lastOpenedAt: r.lastOpenedAt,
        };
      })
    );
    cachedRecentBooks = books;
    return books;
  } catch (err) {
    console.error('Failed to load recent books from SQLite:', err);
    return cachedRecentBooks;
  }
}

export function loadLastOpenedBook(): RecentBook | null {
  return cachedRecentBooks.length > 0 ? cachedRecentBooks[0] : null;
}

const saveRecentBookDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingRecentBooks = new Map<string, RecentBook>();

function persistRecentBookToDb(book: RecentBook): void {
  if (!isTauri()) return;
  fileManager.getBookCoverPath(book.id).then((diskCoverPath) => {
    invoke('db_save_recent_book', {
      book: {
        id: book.id,
        title: book.title,
        author: book.author,
        coverPath: diskCoverPath || null,
        coverUrl: book.coverUrl || null,
        filePath: book.filePath || null,
        fileName: book.fileName || null,
        fileSize: book.fileSize || null,
        lastLocation: book.lastLocation || null,
        progressFraction: book.progressFraction || 0.0,
        lastOpenedAt: book.lastOpenedAt || new Date().toISOString(),
      },
    }).catch((err) => {
      console.error('Failed to save recent book to SQLite:', err);
    });
  });
}

/**
 * Immediately writes any debounced recent book updates to SQLite.
 */
export function flushPendingRecentBook(bookId?: string): void {
  if (bookId) {
    const timer = saveRecentBookDebounceTimers.get(bookId);
    if (timer) {
      clearTimeout(timer);
      saveRecentBookDebounceTimers.delete(bookId);
    }
    const book = pendingRecentBooks.get(bookId);
    if (book) {
      pendingRecentBooks.delete(bookId);
      persistRecentBookToDb(book);
    }
  } else {
    for (const [_, timer] of saveRecentBookDebounceTimers.entries()) {
      clearTimeout(timer);
    }
    saveRecentBookDebounceTimers.clear();
    for (const [_, book] of pendingRecentBooks.entries()) {
      persistRecentBookToDb(book);
    }
    pendingRecentBooks.clear();
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    flushPendingRecentBook();
  });
}

export function saveRecentBook(book: RecentBook, debounceMs: number = 800): void {
  cachedRecentBooks = [
    book,
    ...cachedRecentBooks.filter((b) => b.id !== book.id && (book.filePath ? b.filePath !== book.filePath : true)),
  ];

  if (!isTauri()) return;

  if (debounceMs <= 0) {
    flushPendingRecentBook(book.id);
    persistRecentBookToDb(book);
    return;
  }

  pendingRecentBooks.set(book.id, book);
  const existingTimer = saveRecentBookDebounceTimers.get(book.id);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  saveRecentBookDebounceTimers.set(
    book.id,
    setTimeout(() => {
      saveRecentBookDebounceTimers.delete(book.id);
      pendingRecentBooks.delete(book.id);
      persistRecentBookToDb(book);
    }, debounceMs)
  );
}

export function updateRecentBookMetadata(
  bookId: string,
  meta: {
    title?: string;
    author?: string;
    coverUrl?: string;
  }
): void {
  const target = cachedRecentBooks.find((b) => b.id === bookId);
  if (target) {
    if (meta.title && meta.title !== 'Untitled Book') target.title = meta.title;
    if (meta.author && meta.author !== 'Unknown Author') target.author = meta.author;
    if (meta.coverUrl) target.coverUrl = meta.coverUrl;
  }

  if (isTauri()) {
    fileManager.getBookCoverPath(bookId).then((diskCoverPath) => {
      invoke('db_update_recent_book_meta', {
        id: bookId,
        title: meta.title || null,
        author: meta.author || null,
        coverPath: diskCoverPath || null,
        coverUrl: meta.coverUrl || null,
      }).catch((err) => {
        console.error('Failed to update recent book metadata in SQLite:', err);
      });
    });
  }
}

export async function removeRecentBook(id: string, deleteCover: boolean = false): Promise<void> {
  const timer = saveRecentBookDebounceTimers.get(id);
  if (timer) {
    clearTimeout(timer);
    saveRecentBookDebounceTimers.delete(id);
  }
  pendingRecentBooks.delete(id);

  const matched = cachedRecentBooks.find((b) => b.id === id || b.filePath === id);
  if (matched?.id && matched.id !== id) {
    const t2 = saveRecentBookDebounceTimers.get(matched.id);
    if (t2) {
      clearTimeout(t2);
      saveRecentBookDebounceTimers.delete(matched.id);
    }
    pendingRecentBooks.delete(matched.id);
  }

  cachedRecentBooks = cachedRecentBooks.filter((b) => b.id !== id && b.filePath !== id && (!matched || b.id !== matched.id));

  if (isTauri()) {
    try {
      await invoke('db_remove_recent_book', { id });
      if (matched?.filePath && matched.filePath !== id) {
        await invoke('db_remove_recent_book', { id: matched.filePath });
      }
      if (matched?.id && matched.id !== id) {
        await invoke('db_remove_recent_book', { id: matched.id });
      }
      if (deleteCover) {
        await deleteBookCover(id);
        if (matched?.id && matched.id !== id) {
          await deleteBookCover(matched.id);
        }
      }
    } catch (err) {
      console.error('Failed to remove recent book from SQLite:', err);
    }
  }
}

// ─── Book Location & Progress ──────────────────────────────────────────────

export function loadLastLocation(bookId: string): { cfi?: string; fraction?: number } | null {
  const target = cachedRecentBooks.find((b) => b.id === bookId || (b.filePath && b.filePath === bookId));
  if (target) {
    return { cfi: target.lastLocation, fraction: target.progressFraction };
  }
  return null;
}

export function saveLastLocation(bookId: string, cfi: string, fraction: number): void {
  const target = cachedRecentBooks.find((b) => b.id === bookId);
  if (target) {
    target.lastLocation = cfi;
    target.progressFraction = fraction;
    target.lastOpenedAt = new Date().toISOString();
    saveRecentBook(target);
  }
}

export function resetRecentBookProgress(bookId: string): void {
  removeRecentBook(bookId, false).catch((err) => {
    console.warn(`Failed to remove recent book during progress reset for ${bookId}:`, err);
  });
}

// ─── Local Books Metadata Cache (SQLite) ───────────────────────────────────

export interface LocalBookCacheItem {
  title: string;
  author: string;
  coverUrl?: string;
  extracted?: boolean;
  noCover?: boolean;
}

export interface DbLocalBookMetaRow {
  bookId: string;
  filePath: string;
  title: string;
  author: string;
  coverPath?: string;
  extracted: boolean;
  updatedAt: string;
}

export function loadLocalBooksCache(): Record<string, LocalBookCacheItem> {
  return cachedLocalMeta;
}

export async function loadLocalBooksCacheAsync(): Promise<Record<string, LocalBookCacheItem>> {
  if (!isTauri()) return cachedLocalMeta;

  try {
    const rows = await invoke<DbLocalBookMetaRow[]>('db_get_all_local_books_meta');
    const result: Record<string, LocalBookCacheItem> = {};
    for (const r of rows) {
      let coverUrl: string | undefined;
      let diskPath = r.coverPath;
      const hasNoCoverMarker = diskPath === 'no_cover';
      if (hasNoCoverMarker) {
        diskPath = undefined;
      } else if (!diskPath) {
        diskPath = (await fileManager.getBookCoverPath(r.bookId)) || undefined;
      }
      if (diskPath) {
        coverUrl = convertFileSrc(diskPath);
      }

      result[r.bookId] = {
        title: r.title,
        author: r.author,
        coverUrl,
        extracted: r.extracted,
        noCover: hasNoCoverMarker || (!diskPath && r.extracted),
      };
    }
    cachedLocalMeta = result;
    return result;
  } catch (err) {
    console.error('Failed to load local books metadata from SQLite:', err);
    return cachedLocalMeta;
  }
}

export function saveLocalBookCache(
  bookId: string,
  meta: Partial<LocalBookCacheItem>,
  filePath?: string
): void {
  const existing = cachedLocalMeta[bookId] || { title: '', author: '' };
  const updated: LocalBookCacheItem = { ...existing, ...meta };
  cachedLocalMeta[bookId] = updated;

  if (isTauri()) {
    fileManager.getBookCoverPath(bookId).then((diskCoverPath) => {
      if (diskCoverPath && !updated.coverUrl) {
        updated.coverUrl = convertFileSrc(diskCoverPath);
        cachedLocalMeta[bookId] = updated;
      }
      const coverPathToSave = diskCoverPath || (updated.noCover ? 'no_cover' : null);
      invoke('db_save_local_book_meta', {
        bookId,
        filePath: filePath || '',
        title: updated.title,
        author: updated.author,
        coverPath: coverPathToSave,
        extracted: updated.extracted ?? true,
      }).catch((err) => {
        console.error('Failed to save local book metadata to SQLite:', err);
      });
    });
  }
}

// ─── Master Storage Initialization ─────────────────────────────────────────

/**
 * Initializes all storage subsystems (settings, metadata cache, recent books)
 * from file system and SQLite on app startup. Cleans up legacy oversized localStorage keys.
 */
export async function initStorage(): Promise<void> {
  if (isStorageInitialized) return;
  isStorageInitialized = true;

  try {
    // 1. Load settings from settings.json
    await loadSettingsAsync();

    // 2. Load recent books from SQLite
    await loadRecentBooksAsync();

    // 3. Load local books metadata cache from SQLite
    await loadLocalBooksCacheAsync();

    // 4. Clean up legacy bloated localStorage keys if they exist
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem('foliate_local_books_cache');
        localStorage.removeItem('foliate_recent_books');
        localStorage.removeItem('folio_library_view_mode');
      } catch {
        // ignore
      }
    }
  } catch (err) {
    console.error('Error during initStorage:', err);
  }
}
