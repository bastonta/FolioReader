import { Channel, invoke } from '@tauri-apps/api/core';
import {
  BookHasNoChaptersError,
  BookHasNoFileError,
  VolumesNotSupportedError,
} from '../api/libraryApi';
import {
  ChaptersBookDownloadResult,
  ChaptersDownloadProgress,
  LocalBookFile,
} from '../types/browse';

/** Error string returned by the `download_book_file` command for `Chapters` books (HTTP 409). */
const BOOK_HAS_NO_FILE_ERROR = 'BOOK_HAS_NO_FILE';

/** Error string returned by the `download_chapters_book` command for a book without chapters. */
const BOOK_HAS_NO_CHAPTERS_ERROR = 'BOOK_HAS_NO_CHAPTERS';

/** Error string returned by `download_chapters_book` when the server cannot list volumes. */
const VOLUMES_NOT_SUPPORTED_ERROR = 'VOLUMES_NOT_SUPPORTED';

/** Size of the pieces a book file is read in (the core returns at most 16 MiB per call). */
const BOOK_READ_CHUNK_BYTES = 8 * 1024 * 1024;

export interface DownloadBookOptions {
  serverUrl: string;
  token?: string;
  bookId: string;
  fileName: string;
  title?: string;
  author?: string;
  seriesName?: string;
  baseDir: string;
  customTargetDir?: string;
  progress?: {
    location?: string;
    progressPercent?: number;
    isRead?: boolean;
    updatedAt?: string;
  };
}

export const fileManager = {
  /**
   * Checks if storage permission is granted (on Android). Returns true on desktop.
   */
  hasStoragePermission: async (): Promise<boolean> => {
    try {
      const androidBridge = (window as any).AndroidBridge;
      if (androidBridge && typeof androidBridge.hasStoragePermission === 'function') {
        return Boolean(androidBridge.hasStoragePermission());
      }
      return true;
    } catch (err) {
      console.warn('Failed to check storage permission:', err);
      return true;
    }
  },

  /**
   * Requests storage permission from OS (on Android).
   */
  requestStoragePermission: async (): Promise<void> => {
    try {
      const androidBridge = (window as any).AndroidBridge;
      if (androidBridge && typeof androidBridge.requestStoragePermission === 'function') {
        androidBridge.requestStoragePermission();
      }
    } catch (err) {
      console.warn('Failed to request storage permission:', err);
    }
  },

  /**
   * Retrieves default download folder path from OS (e.g. ~/Downloads/FolioBooks or Android /storage/emulated/0/Download/FolioBooks).
   */
  getDefaultDownloadDir: async (): Promise<string> => {
    try {
      const androidBridge = (window as any).AndroidBridge;
      if (androidBridge && typeof androidBridge.getDefaultDownloadDir === 'function') {
        const dir = androidBridge.getDefaultDownloadDir();
        if (dir) return dir;
      }
      return await invoke<string>('get_default_download_dir');
    } catch (err) {
      console.warn('Failed to get default download dir from Tauri:', err);
      return '';
    }
  },

  /**
   * Opens native folder picker dialog (supports Desktop dialog and Android SAF document tree).
   */
  pickFolder: async (defaultPath?: string): Promise<string | null> => {
    try {
      const androidBridge = (window as any).AndroidBridge;
      if (androidBridge && typeof androidBridge.openFolderPicker === 'function') {
        return new Promise<string | null>((resolve) => {
          const originalCallback = (window as any).onAndroidFolderSelected;
          const timer = setTimeout(() => {
            (window as any).onAndroidFolderSelected = originalCallback;
            resolve(null);
          }, 60000); // 60s timeout

          (window as any).onAndroidFolderSelected = (path: string) => {
            clearTimeout(timer);
            (window as any).onAndroidFolderSelected = originalCallback;
            resolve(path || null);
          };

          try {
            androidBridge.openFolderPicker();
          } catch (e) {
            clearTimeout(timer);
            (window as any).onAndroidFolderSelected = originalCallback;
            resolve(null);
          }
        });
      }

      const result = await invoke<string | null>('pick_folder', {
        defaultPath: defaultPath || null,
      });
      return result;
    } catch (err) {
      console.error('Failed to open folder picker:', err);
      return null;
    }
  },

  /**
   * Recursively scans directory for .epub book files.
   */
  scanLocalBooks: async (dirPath: string): Promise<LocalBookFile[]> => {
    if (!dirPath || !dirPath.trim()) return [];
    try {
      return await invoke<LocalBookFile[]>('scan_local_books', { dirPath });
    } catch (err) {
      console.error(`Failed to scan local books in '${dirPath}':`, err);
      return [];
    }
  },

  /**
   * Reads a local book file from disk and returns a File.
   *
   * The reading engine needs a real `File`, so the whole book still ends up in
   * the WebView, but it gets there in pieces: neither the core nor the IPC
   * bridge ever holds a book of several hundred megabytes in one buffer, and
   * every piece becomes a part of the resulting file as soon as it arrives.
   */
  readBookFile: async (filePath: string): Promise<File> => {
    const fileName = filePath.split(/[\\/]/).pop() || 'book.epub';
    try {
      const size = await invoke<number>('get_book_file_size', { filePath });
      const parts: Blob[] = [];
      let offset = 0;
      while (offset < size) {
        const chunk = await invoke<ArrayBuffer>('read_book_file_range', {
          filePath,
          offset,
          length: Math.min(BOOK_READ_CHUNK_BYTES, size - offset),
        });
        const bytes = new Uint8Array(chunk);
        // The file became shorter while it was being read
        if (bytes.byteLength === 0) break;
        parts.push(new Blob([bytes]));
        offset += bytes.byteLength;
      }
      if (offset === size) {
        return new File(parts, fileName, { type: 'application/epub+zip' });
      }
      console.warn(`'${filePath}' changed while it was being read, reading it again in one piece`);
    } catch (err) {
      console.warn(`Failed to read '${filePath}' in pieces, reading it in one piece:`, err);
    }

    try {
      const arrayBuffer = await invoke<ArrayBuffer>('read_book_file', { filePath });
      return new File([arrayBuffer], fileName, { type: 'application/epub+zip' });
    } catch (err) {
      console.error(`Failed to read book file '${filePath}':`, err);
      throw err;
    }
  },

  /**
   * Downloads a book from the Folio server into the download folder / series subfolders (supports nested paths, e.g. "Мир Элдерлингов/Сага о Видящих").
   */
  downloadBookFile: async (options: DownloadBookOptions): Promise<string> => {
    try {
      return await invoke<string>('download_book_file', {
        serverUrl: options.serverUrl,
        token: options.token || null,
        bookId: options.bookId,
        fileName: options.fileName,
        title: options.title || null,
        author: options.author || null,
        seriesName: options.seriesName || null,
        baseDir: options.baseDir,
        customTargetDir: options.customTargetDir || null,
        progress: options.progress || null,
      });
    } catch (err) {
      if (typeof err === 'string' && err === BOOK_HAS_NO_FILE_ERROR) {
        throw new BookHasNoFileError(options.bookId);
      }
      console.error(`Failed to download book '${options.fileName}':`, err);
      throw err;
    }
  },

  /**
   * Builds (or updates) a local EPUB copy of a book the server stores as separate chapters
   * (`Chapters` kind, no file to download). Running it again for a downloaded book fetches
   * only new and changed chapters. `onProgress` reports chapters / illustrations as they arrive.
   *
   * With `volume` only that volume is downloaded, as a file of its own next to where the
   * whole book would go; every such copy is updated independently.
   */
  downloadChaptersBook: async (
    options: DownloadBookOptions & { volume?: number },
    onProgress?: (progress: ChaptersDownloadProgress) => void,
  ): Promise<ChaptersBookDownloadResult> => {
    const channel = new Channel<ChaptersDownloadProgress>();
    channel.onmessage = (progress) => onProgress?.(progress);
    try {
      return await invoke<ChaptersBookDownloadResult>('download_chapters_book', {
        serverUrl: options.serverUrl,
        token: options.token || null,
        bookId: options.bookId,
        fileName: options.fileName,
        title: options.title || null,
        author: options.author || null,
        seriesName: options.seriesName || null,
        baseDir: options.baseDir,
        customTargetDir: options.customTargetDir || null,
        progress: options.progress || null,
        volume: options.volume ?? null,
        onProgress: channel,
      });
    } catch (err) {
      if (typeof err === 'string' && err === BOOK_HAS_NO_CHAPTERS_ERROR) {
        throw new BookHasNoChaptersError(options.bookId);
      }
      if (typeof err === 'string' && err === VOLUMES_NOT_SUPPORTED_ERROR) {
        throw new VolumesNotSupportedError(options.bookId);
      }
      console.error(`Failed to download chapters of '${options.fileName}':`, err);
      throw err;
    }
  },

  /**
   * Deletes a local book file from disk.
   */
  deleteBookFile: async (filePath: string): Promise<boolean> => {
    try {
      return await invoke<boolean>('delete_book_file', { filePath });
    } catch (err) {
      console.error(`Failed to delete book file '${filePath}':`, err);
      return false;
    }
  },

  /**
   * Finds the file of a server book that was downloaded before the application recorded
   * what it downloads. The core accepts a file only if the server recognises its content
   * as this very book (a file that merely has the expected name belongs to some other
   * book) and then records the binding itself. `null`: no such file.
   */
  findDownloadedBook: async (options: {
    serverUrl: string;
    token: string;
    bookId: string;
    fileName: string;
    seriesName?: string;
    baseDir: string;
  }): Promise<string | null> => {
    if (!options.baseDir) return null;
    return invoke<string | null>('find_downloaded_book', {
      serverUrl: options.serverUrl,
      token: options.token,
      bookId: options.bookId,
      fileName: options.fileName,
      seriesName: options.seriesName || null,
      baseDir: options.baseDir,
    });
  },

  /**
   * Checks if book already exists in download folder / series folder (including nested series path and recursive search).
   * A file found this way only has the name of the book: use `findDownloadedBook` to decide whether it is the book.
   */
  checkBookDownloaded: async (options: {
    baseDir: string;
    fileName: string;
    seriesName?: string;
  }): Promise<string | null> => {
    if (!options.baseDir) return null;
    try {
      return await invoke<string | null>('check_book_downloaded', {
        baseDir: options.baseDir,
        fileName: options.fileName,
        seriesName: options.seriesName || null,
      });
    } catch (err) {
      console.warn('Check book downloaded error:', err);
      return null;
    }
  },

  /**
   * Generates a consistent local book ID from filePath and optional baseDir,
   * matching the logic in Rust `fs_manager.rs`.
   */
  getLocalBookId: (filePath: string, baseDir?: string): string => {
    let relPath = filePath;
    if (baseDir) {
      const normalizedBase = baseDir.replace(/\\/g, '/').replace(/\/+$/, '');
      const normalizedPath = filePath.replace(/\\/g, '/');
      if (normalizedPath.startsWith(normalizedBase + '/')) {
        relPath = normalizedPath.slice(normalizedBase.length + 1);
      }
    }
    const sanitized = relPath.replace(/\\/g, '/').replace(/[/\\ .]/g, '_');
    return `local-${sanitized}`;
  },

  /**
   * Saves a book cover blob or base64 string to app data /covers/{bookId}.jpg
   * Returns the absolute file path on disk.
   */
  saveBookCover: async (bookId: string, data: Blob | string): Promise<string> => {
    try {
      let base64Data: string;
      if (typeof data === 'string') {
        base64Data = data;
      } else {
        base64Data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = (e) => reject(e);
          reader.readAsDataURL(data);
        });
      }

      return await invoke<string>('save_book_cover', {
        bookId,
        base64Data,
      });
    } catch (err) {
      console.error(`Failed to save book cover for '${bookId}':`, err);
      throw err;
    }
  },

  /**
   * Gets the file path of a saved book cover if it exists.
   */
  getBookCoverPath: async (bookId: string): Promise<string | null> => {
    try {
      return await invoke<string | null>('get_book_cover_path', { bookId });
    } catch (err) {
      console.warn(`Failed to get book cover path for '${bookId}':`, err);
      return null;
    }
  },

  /**
   * Deletes a book cover file from disk.
   */
  deleteBookCover: async (bookId: string): Promise<boolean> => {
    try {
      return await invoke<boolean>('delete_book_cover', { bookId });
    } catch (err) {
      console.warn(`Failed to delete book cover for '${bookId}':`, err);
      return false;
    }
  },

  /**
   * Clears the entire covers cache directory.
   */
  clearCoversCache: async (): Promise<void> => {
    try {
      await invoke('clear_covers_cache');
    } catch (err) {
      console.warn('Failed to clear covers cache:', err);
    }
  },

  /**
   * Reads settings.json from app local data folder.
   */
  loadAppSettings: async (): Promise<string | null> => {
    try {
      return await invoke<string | null>('load_app_settings');
    } catch (err) {
      console.warn('Failed to load settings.json:', err);
      return null;
    }
  },

  /**
   * Writes settings.json to app local data folder.
   */
  saveAppSettings: async (settingsJson: string): Promise<void> => {
    try {
      await invoke('save_app_settings', { settingsJson });
    } catch (err) {
      console.warn('Failed to save settings.json:', err);
    }
  },
};
