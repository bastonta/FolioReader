import { convertFileSrc } from '@tauri-apps/api/core';
import { LocalBookFile } from '../types/browse';
import { fileManager } from './fileManager';
import {
  LocalBookCacheItem,
  saveLocalBookCache,
  formatLanguageMap,
  formatContributor,
  updateRecentBookMetadata,
} from './storage';
import { getDbServerBookId } from './readerDb';
import { getServerUrl, getAccessToken } from '../api/tokenManager';

export interface ExtractedMetaResult {
  title: string;
  author: string;
  coverUrl?: string;
  extracted: boolean;
  noCover?: boolean;
}

/**
 * Extracts metadata and cover image from a local book file.
 * If cover already exists on disk and forceRecreateCover is false, skips re-extraction of cover.
 * If cover is missing on disk or forceRecreateCover is true, extracts from EPUB or server fallback.
 */
export async function extractBookCoverAndMeta(
  book: LocalBookFile,
  options: {
    forceRecreateCover?: boolean;
    cachedMeta?: LocalBookCacheItem;
  } = {}
): Promise<ExtractedMetaResult> {
  const { forceRecreateCover = false, cachedMeta } = options;

  let title = cachedMeta?.title || book.fileName.replace(/\.[^/.]+$/, '');
  let author = cachedMeta?.author || 'Unknown Author';
  let coverUrl: string | undefined = undefined;
  let extracted = cachedMeta?.extracted || false;

  // 1. Check if cover file already exists on disk
  try {
    const existingDiskPath = await fileManager.getBookCoverPath(book.id);
    if (existingDiskPath) {
      coverUrl = convertFileSrc(existingDiskPath);
    }
  } catch (err) {
    console.warn(`Failed to check disk cover for '${book.id}':`, err);
  }

  // If cover exists on disk (or confirmed no cover) and we have valid metadata and force is false, return immediately
  if ((coverUrl || cachedMeta?.noCover) && !forceRecreateCover && extracted) {
    return { title, author, coverUrl, extracted: true, noCover: cachedMeta?.noCover };
  }

  // 2. Read book file bytes and extract metadata & cover from EPUB
  try {
    const file = await fileManager.readBookFile(book.filePath);
    if (file) {
      const { makeBook } = await import('../foliate-js/view.js');
      const parsedBook: any = await makeBook(file);
      if (parsedBook) {
        if (parsedBook.metadata?.title) {
          const parsedTitle = formatLanguageMap(parsedBook.metadata.title);
          if (parsedTitle && parsedTitle.trim()) {
            title = parsedTitle.trim();
          }
        }
        if (parsedBook.metadata?.author || parsedBook.metadata?.creator) {
          const parsedAuthor = formatContributor(
            parsedBook.metadata.author || parsedBook.metadata.creator
          );
          if (parsedAuthor && parsedAuthor.trim() && parsedAuthor !== 'Unknown Author') {
            author = parsedAuthor.trim();
          }
        }

        // If cover is missing on disk or forced, extract cover blob
        if (!coverUrl || forceRecreateCover) {
          if (typeof parsedBook.getCover === 'function') {
            try {
              const coverBlob = await Promise.resolve(parsedBook.getCover());
              if (coverBlob && coverBlob instanceof Blob && coverBlob.size > 0) {
                const savedPath = await fileManager.saveBookCover(book.id, coverBlob);
                if (savedPath) {
                  // Add cache-busting timestamp so browser reloads newly generated cover
                  coverUrl = `${convertFileSrc(savedPath)}?t=${Date.now()}`;
                }
              }
            } catch (coverErr) {
              console.warn(`Cover blob extraction failed for '${book.fileName}':`, coverErr);
            }
          }
        }

        try {
          parsedBook.destroy?.();
        } catch {
          // ignore cleanup errors
        }
        extracted = true;
      }
    }
  } catch (err) {
    console.warn(`Metadata extraction failed for '${book.fileName}':`, err);
  }

  // 3. Fallback: If cover still missing, check if book is mapped to Folio server and fetch cover from server
  if (!coverUrl) {
    try {
      const serverBookId = await getDbServerBookId(book.id);
      const serverUrl = getServerUrl();
      if (serverBookId && serverUrl) {
        const token = getAccessToken();
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        const resp = await fetch(`${serverUrl.trim().replace(/\/+$/, '')}/api/books/${serverBookId}/cover`, {
          headers,
        });

        if (resp.ok) {
          const blob = await resp.blob();
          if (blob && blob.size > 0) {
            const savedPath = await fileManager.saveBookCover(book.id, blob);
            if (savedPath) {
              coverUrl = `${convertFileSrc(savedPath)}?t=${Date.now()}`;
            }
          }
        }
      }
    } catch (serverErr) {
      console.warn(`Server cover fallback failed for '${book.id}':`, serverErr);
    }
  }

  const resultMeta: ExtractedMetaResult = {
    title,
    author,
    coverUrl,
    extracted,
    noCover: !coverUrl,
  };

  // 4. Persist to SQLite metadata and in-memory caches
  saveLocalBookCache(book.id, resultMeta, book.filePath);
  updateRecentBookMetadata(book.id, {
    title: resultMeta.title !== 'Untitled Book' ? resultMeta.title : undefined,
    author: resultMeta.author !== 'Unknown Author' ? resultMeta.author : undefined,
    coverUrl: resultMeta.coverUrl,
  });

  return resultMeta;
}

/**
 * Checks all local books for missing covers on disk and extracts/recreates them.
 * Processes in bounded concurrency to maintain high performance.
 */
export async function verifyAndRecreateMissingCovers(
  books: LocalBookFile[],
  currentCache: Record<string, LocalBookCacheItem>,
  onUpdate?: (bookId: string, meta: ExtractedMetaResult) => void
): Promise<Record<string, LocalBookCacheItem>> {
  if (!books.length) return currentCache;

  const updatedCache = { ...currentCache };
  const queue: LocalBookFile[] = [];

  // Filter books that need cover check or extraction
  for (const book of books) {
    const cached = currentCache[book.id];
    let hasDiskCover = false;
    try {
      const diskPath = await fileManager.getBookCoverPath(book.id);
      hasDiskCover = Boolean(diskPath);
    } catch {
      hasDiskCover = false;
    }

    // If this book was already extracted and confirmed to have no cover, skip re-extracting
    if (cached?.extracted && cached?.noCover) {
      continue;
    }

    // If disk cover exists and metadata is already extracted, skip re-extracting
    if (hasDiskCover && cached?.extracted && cached.coverUrl) {
      continue;
    }

    // Only queue if not yet extracted or if disk cover is missing and book isn't verified as noCover
    if (!cached || !cached.extracted || (!hasDiskCover && !cached.noCover)) {
      queue.push(book);
    }
  }

  if (queue.length === 0) return updatedCache;

  // Process in parallel with concurrency limit = 3
  const CONCURRENCY = 3;
  let index = 0;

  async function worker() {
    while (index < queue.length) {
      const currentIndex = index++;
      const book = queue[currentIndex];
      if (!book) break;

      try {
        const meta = await extractBookCoverAndMeta(book, {
          forceRecreateCover: true,
          cachedMeta: updatedCache[book.id],
        });
        updatedCache[book.id] = meta;
        onUpdate?.(book.id, meta);
      } catch (err) {
        console.warn(`Worker failed to process cover for '${book.fileName}':`, err);
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker());
  await Promise.all(workers);

  return updatedCache;
}
