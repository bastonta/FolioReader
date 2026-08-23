import { Annotation, Bookmark, ReaderSettings, RecentBook } from '../types/reader';

const SETTINGS_KEY = 'foliate_reader_settings';
const RECENT_BOOKS_KEY = 'foliate_recent_books';
const LOCATIONS_KEY = 'foliate_book_locations';
const ANNOTATIONS_KEY = 'foliate_book_annotations';
const BOOKMARKS_KEY = 'foliate_book_bookmarks';
const LOCAL_CACHE_KEY = 'foliate_local_books_cache';

export const DEFAULT_SETTINGS: ReaderSettings = {
  flow: 'paginated',
  columns: 'auto',
  fontFamily: 'Georgia, serif',
  fontSize: 18,
  spacing: 1.5,
  margin: 48,
  justify: true,
  hyphenate: true,
  theme: 'light',
  pageTurnMethod: 'both',
  sidebarPinned: true,
  sidebarOpen: true,
  activeTab: 'contents',
  downloadPath: '',
  createSeriesFolder: true,
  libraryViewMode: 'grid',
};

// IndexedDB for storing book covers
const DB_NAME = 'FolioBookDB';
const DB_VERSION = 2;
const COVERS_STORE = 'books_covers';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(COVERS_STORE)) {
        db.createObjectStore(COVERS_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
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
    return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Partial<ReaderSettings>): ReaderSettings {
  const current = loadSettings();
  const updated = { ...current, ...settings };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  return updated;
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

// Book Progress / Location
export function loadLastLocation(bookId: string): { cfi?: string; fraction?: number } | null {
  try {
    const data = localStorage.getItem(LOCATIONS_KEY);
    if (!data) return null;
    const map = JSON.parse(data);
    return map[bookId] || null;
  } catch {
    return null;
  }
}

export function saveLastLocation(bookId: string, cfi: string, fraction: number): void {
  try {
    const data = localStorage.getItem(LOCATIONS_KEY);
    const map = data ? JSON.parse(data) : {};
    map[bookId] = { cfi, fraction, updatedAt: new Date().toISOString() };
    localStorage.setItem(LOCATIONS_KEY, JSON.stringify(map));

    // Update in recent books as well
    const recent = loadRecentBooks();
    const target = recent.find((b) => b.id === bookId);
    if (target) {
      target.lastLocation = cfi;
      target.progressFraction = fraction;
      target.lastOpenedAt = new Date().toISOString();
      localStorage.setItem(RECENT_BOOKS_KEY, JSON.stringify(recent));
    }
  } catch (err) {
    console.error('Failed to save location:', err);
  }
}

// Annotations
export function loadAnnotations(bookId: string): Annotation[] {
  try {
    const data = localStorage.getItem(ANNOTATIONS_KEY);
    if (!data) return [];
    const map = JSON.parse(data);
    return map[bookId] || [];
  } catch {
    return [];
  }
}

export function saveAnnotation(annotation: Annotation): void {
  try {
    const data = localStorage.getItem(ANNOTATIONS_KEY);
    const map = data ? JSON.parse(data) : {};
    const list: Annotation[] = map[annotation.bookId] || [];
    const idx = list.findIndex((a) => a.id === annotation.id || a.value === annotation.value);
    if (idx >= 0) {
      list[idx] = annotation;
    } else {
      list.unshift(annotation);
    }
    map[annotation.bookId] = list;
    localStorage.setItem(ANNOTATIONS_KEY, JSON.stringify(map));
  } catch (err) {
    console.error('Failed to save annotation:', err);
  }
}

export function deleteAnnotation(bookId: string, annotationIdOrValue: string): void {
  try {
    const data = localStorage.getItem(ANNOTATIONS_KEY);
    if (!data) return;
    const map = JSON.parse(data);
    const list: Annotation[] = map[bookId] || [];
    map[bookId] = list.filter((a) => a.id !== annotationIdOrValue && a.value !== annotationIdOrValue);
    localStorage.setItem(ANNOTATIONS_KEY, JSON.stringify(map));
  } catch (err) {
    console.error('Failed to delete annotation:', err);
  }
}

// Bookmarks
export function loadBookmarks(bookId: string): Bookmark[] {
  try {
    const data = localStorage.getItem(BOOKMARKS_KEY);
    if (!data) return [];
    const map = JSON.parse(data);
    return map[bookId] || [];
  } catch {
    return [];
  }
}

export function saveBookmark(bookmark: Bookmark): void {
  try {
    const data = localStorage.getItem(BOOKMARKS_KEY);
    const map = data ? JSON.parse(data) : {};
    const list: Bookmark[] = map[bookmark.bookId] || [];
    const exists = list.some((b) => b.cfi === bookmark.cfi);
    if (!exists) {
      list.unshift(bookmark);
      map[bookmark.bookId] = list;
      localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(map));
    }
  } catch (err) {
    console.error('Failed to save bookmark:', err);
  }
}

export function deleteBookmark(bookId: string, bookmarkId: string): void {
  try {
    const data = localStorage.getItem(BOOKMARKS_KEY);
    if (!data) return;
    const map = JSON.parse(data);
    const list: Bookmark[] = map[bookId] || [];
    map[bookId] = list.filter((b) => b.id !== bookmarkId);
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(map));
  } catch (err) {
    console.error('Failed to delete bookmark:', err);
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
