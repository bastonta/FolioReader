import { ReaderSettings, RecentBook } from '../types/reader';
import { clearDbAllData } from './readerDb';
import { clearTokens, getServerUrl } from '../api/tokenManager';

const SETTINGS_KEY = 'foliate_reader_settings';
const RECENT_BOOKS_KEY = 'foliate_recent_books';
const LOCAL_CACHE_KEY = 'foliate_local_books_cache';

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
};

// IndexedDB for storing book covers
const DB_NAME = 'FolioBookDB';
const DB_VERSION = 2;
const COVERS_STORE = 'books_covers';

let dbInstance: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(COVERS_STORE)) {
        db.createObjectStore(COVERS_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      dbInstance = request.result;
      dbInstance.onversionchange = () => {
        dbInstance?.close();
        dbInstance = null;
      };
      resolve(dbInstance);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function clearIndexedDb(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;

  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore
    }
    dbInstance = null;
  }

  if (typeof (indexedDB as any).databases === 'function') {
    try {
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
    } catch (e) {
      console.warn('Error deleting databases via indexedDB.databases():', e);
    }
  }

  return new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

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

  // 2. Clear IndexedDB
  try {
    await clearIndexedDb();
  } catch (err) {
    console.error('Failed to clear IndexedDB:', err);
  }

  // 3. Clear localStorage
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

  // 4. Clear memory tokens & cookies
  clearTokens();
}

export async function storeBookCover(id: string, coverBlob: Blob): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(COVERS_STORE, 'readwrite');
      const store = tx.objectStore(COVERS_STORE);
      const req = store.put({ id, data: coverBlob });
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('Failed to store cover blob in IndexedDB:', err);
  }
}

export async function loadBookCover(id: string): Promise<Blob | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(COVERS_STORE, 'readonly');
      const store = tx.objectStore(COVERS_STORE);
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result ? req.result.data : null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('Failed to load cover blob from IndexedDB:', err);
    return null;
  }
}

export async function deleteBookCover(id: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(COVERS_STORE, 'readwrite');
      const store = tx.objectStore(COVERS_STORE);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.error('Failed to delete cover blob from IndexedDB:', err);
  }
}

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
  const keys = Object.keys(x);
  return x[keys[0]] || '';
};

export const formatContributor = (contributor: any): string => {
  if (!contributor) return '';
  if (typeof contributor === 'string') return contributor;
  if (Array.isArray(contributor)) {
    return contributor
      .map((c) => (typeof c === 'string' ? c : formatLanguageMap(c?.name || c)))
      .join(', ');
  }
  return formatLanguageMap(contributor?.name || contributor);
};

// Settings
export function loadSettings(): ReaderSettings {
  try {
    const data = localStorage.getItem(SETTINGS_KEY);
    if (!data) return DEFAULT_SETTINGS;
    const parsed: ReaderSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    if (!parsed.sidebarPinned) {
      parsed.sidebarOpen = false;
    }
    return parsed;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Partial<ReaderSettings>): ReaderSettings {
  try {
    const data = localStorage.getItem(SETTINGS_KEY);
    const current = data ? { ...DEFAULT_SETTINGS, ...JSON.parse(data) } : DEFAULT_SETTINGS;
    const updated = { ...current, ...settings };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return { ...DEFAULT_SETTINGS, ...settings };
  }
}

// Recent Books
export function loadRecentBooks(): RecentBook[] {
  try {
    const data = localStorage.getItem(RECENT_BOOKS_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function loadLastOpenedBook(): RecentBook | null {
  const list = loadRecentBooks();
  return list.length > 0 ? list[0] : null;
}

export function saveRecentBook(book: RecentBook): void {
  const books = loadRecentBooks().filter((b) => b.id !== book.id && (book.filePath ? b.filePath !== book.filePath : true));
  books.unshift(book);
  localStorage.setItem(RECENT_BOOKS_KEY, JSON.stringify(books));
}

export function updateRecentBookMetadata(
  bookId: string,
  meta: {
    title?: string;
    author?: string;
    coverUrl?: string;
  }
): void {
  try {
    const recent = loadRecentBooks();
    const target = recent.find((b) => b.id === bookId);
    if (target) {
      if (meta.title && meta.title !== 'Untitled Book') target.title = meta.title;
      if (meta.author && meta.author !== 'Unknown Author') target.author = meta.author;
      if (meta.coverUrl) target.coverUrl = meta.coverUrl;
      localStorage.setItem(RECENT_BOOKS_KEY, JSON.stringify(recent));
    }
  } catch (err) {
    console.error('Failed to update recent book metadata:', err);
  }
}

export async function removeRecentBook(id: string): Promise<void> {
  const books = loadRecentBooks().filter((b) => b.id !== id);
  localStorage.setItem(RECENT_BOOKS_KEY, JSON.stringify(books));
  await deleteBookCover(id);
}

// Book Progress / Location (saved in recent books)
export function loadLastLocation(bookId: string): { cfi?: string; fraction?: number } | null {
  try {
    const recent = loadRecentBooks();
    const target = recent.find((b) => b.id === bookId || (b.filePath && b.filePath === bookId));
    if (target) {
      return { cfi: target.lastLocation, fraction: target.progressFraction };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveLastLocation(bookId: string, cfi: string, fraction: number): void {
  try {
    const recent = loadRecentBooks();
    const target = recent.find((b) => b.id === bookId);
    if (target) {
      target.lastLocation = cfi;
      target.progressFraction = fraction;
      target.lastOpenedAt = new Date().toISOString();
      localStorage.setItem(RECENT_BOOKS_KEY, JSON.stringify(recent));
    }
  } catch (err) {
    console.error('Failed to save location to recent books:', err);
  }
}

export function resetRecentBookProgress(bookId: string): void {
  try {
    const recent = loadRecentBooks();
    const target = recent.find((b) => b.id === bookId || (b.filePath && b.filePath === bookId));
    if (target) {
      target.lastLocation = undefined;
      target.progressFraction = 0;
      localStorage.setItem(RECENT_BOOKS_KEY, JSON.stringify(recent));
    }
  } catch (err) {
    console.error('Failed to reset recent book progress:', err);
  }
}

// Local Books Metadata Cache
export interface LocalBookCacheItem {
  title: string;
  author: string;
  coverUrl?: string;
  extracted?: boolean;
}

export function loadLocalBooksCache(): Record<string, LocalBookCacheItem> {
  try {
    const data = localStorage.getItem(LOCAL_CACHE_KEY);
    return data ? JSON.parse(data) : {};
  } catch {
    return {};
  }
}

export function saveLocalBookCache(
  bookId: string,
  meta: Partial<LocalBookCacheItem>
): void {
  try {
    const current = loadLocalBooksCache();
    const existing = current[bookId] || { title: '', author: '' };
    current[bookId] = { ...existing, ...meta };
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(current));
  } catch (err) {
    console.error('Failed to save local book cache:', err);
  }
}
