import { invoke } from '@tauri-apps/api/core';
import { LocalBookFile } from '../types/browse';

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
   * Reads raw bytes of a local book file from disk and returns a File.
   */
  readBookFile: async (filePath: string): Promise<File> => {
    try {
      const arrayBuffer = await invoke<ArrayBuffer>('read_book_file', { filePath });
      const fileName = filePath.split(/[\\/]/).pop() || 'book.epub';
      return new File([arrayBuffer], fileName, { type: 'application/epub+zip' });
    } catch (err) {
      console.error(`Failed to read book file '${filePath}':`, err);
      throw err;
    }
  },

  /**
   * Downloads a book from the Folio server into the download folder / series subfolders (supports nested paths, e.g. "Мир Элдерлингов/Сага о Видящих").
   */
  downloadBookFile: async (options: {
    serverUrl: string;
    token?: string;
    bookId: string;
    fileName: string;
    seriesName?: string;
    baseDir: string;
    customTargetDir?: string;
  }): Promise<string> => {
    try {
      return await invoke<string>('download_book_file', {
        serverUrl: options.serverUrl,
        token: options.token || null,
        bookId: options.bookId,
        fileName: options.fileName,
        seriesName: options.seriesName || null,
        baseDir: options.baseDir,
        customTargetDir: options.customTargetDir || null,
      });
    } catch (err) {
      console.error(`Failed to download book '${options.fileName}':`, err);
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
   * Checks if book already exists in download folder / series folder (including nested series path and recursive search).
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
};
