import { invoke } from '@tauri-apps/api/core';
import { CustomFontInfo, LoadedCustomFont } from '../types/font';

type FontChangeListener = (fonts: LoadedCustomFont[]) => void;

class FontManager {
  private cachedFonts: LoadedCustomFont[] = [];
  private listeners: Set<FontChangeListener> = new Set();
  private isInitialized = false;
  /** FontFace registered in `document.fonts` for each font file path. */
  private fontFaces: Map<string, FontFace> = new Map();
  private loadPromise: Promise<LoadedCustomFont[]> | null = null;

  /** Identity of a font file on disk: a replaced file is loaded again. */
  private static fileKey(font: CustomFontInfo): string {
    return `${font.filePath}\n${font.fileSize}`;
  }

  private registerFontFace(filePath: string, face: FontFace | null) {
    const previous = this.fontFaces.get(filePath);
    if (previous) {
      document.fonts.delete(previous);
      this.fontFaces.delete(filePath);
    }
    if (face) {
      document.fonts.add(face);
      this.fontFaces.set(filePath, face);
    }
  }

  public subscribe(listener: FontChangeListener): () => void {
    this.listeners.add(listener);
    if (this.isInitialized) {
      listener(this.cachedFonts);
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    this.listeners.forEach((cb) => {
      try {
        cb(this.cachedFonts);
      } catch (err) {
        console.error('Error in font change listener:', err);
      }
    });
  }

  /**
   * Lists all installed custom fonts from the app data folder.
   */
  public async listFonts(): Promise<CustomFontInfo[]> {
    try {
      return await invoke<CustomFontInfo[]>('list_custom_fonts');
    } catch (err) {
      console.error('Failed to list custom fonts:', err);
      return [];
    }
  }

  /**
   * Reads a font file and converts it into a data URL and registers in document.fonts.
   */
  public async loadFont(font: CustomFontInfo): Promise<LoadedCustomFont> {
    try {
      const bytes = await invoke<number[]>('read_font_file', { filePath: font.filePath });
      const uint8 = new Uint8Array(bytes);

      let mime = 'font/ttf';
      if (font.format === 'woff2') mime = 'font/woff2';
      else if (font.format === 'woff') mime = 'font/woff';
      else if (font.format === 'opentype') mime = 'font/otf';

      // Convert uint8 to binary string safely for base64
      let binary = '';
      const len = uint8.byteLength;
      const chunkSize = 8192;
      for (let i = 0; i < len; i += chunkSize) {
        const chunk = uint8.subarray(i, Math.min(i + chunkSize, len));
        binary += String.fromCharCode.apply(null, chunk as any);
      }
      const base64 = btoa(binary);
      const dataUrl = `data:${mime};base64,${base64}`;

      // Register in document.fonts for UI preview
      try {
        const fontFace = new FontFace(font.fontFamily, uint8.buffer, { weight: '100 900' });
        await fontFace.load();
        this.registerFontFace(font.filePath, fontFace);
      } catch (fontFaceErr) {
        console.warn(`Failed to register FontFace '${font.fontFamily}':`, fontFaceErr);
      }

      return {
        ...font,
        dataUrl,
        isLoaded: true,
      };
    } catch (err) {
      console.error(`Failed to load font '${font.name}':`, err);
      return {
        ...font,
        isLoaded: false,
      };
    }
  }

  /**
   * Brings the loaded fonts in line with the fonts folder.
   *
   * Font files are read once: a font that is already loaded is reused, only
   * new or replaced files are read, and fonts whose file is gone are dropped.
   * Listeners are notified (and the returned array changes identity) only
   * when the set of fonts actually changed, so calling this on every reader
   * or settings open is cheap. Concurrent calls share one run.
   */
  public loadAllFonts(): Promise<LoadedCustomFont[]> {
    if (!this.loadPromise) {
      this.loadPromise = this.refreshFonts().finally(() => {
        this.loadPromise = null;
      });
    }
    return this.loadPromise;
  }

  private async refreshFonts(): Promise<LoadedCustomFont[]> {
    const list = await this.listFonts();
    const known = new Map(
      this.cachedFonts.filter((f) => f.isLoaded).map((f) => [FontManager.fileKey(f), f] as const)
    );

    let changed = !this.isInitialized || list.length !== this.cachedFonts.length;
    const loaded = await Promise.all(
      list.map((f) => {
        const existing = known.get(FontManager.fileKey(f));
        if (existing) return existing;
        changed = true;
        return this.loadFont(f);
      })
    );

    const present = new Set(list.map((f) => f.filePath));
    for (const filePath of Array.from(this.fontFaces.keys())) {
      if (!present.has(filePath)) this.registerFontFace(filePath, null);
    }

    if (changed) {
      this.cachedFonts = loaded;
      this.isInitialized = true;
      this.notify();
    }
    return this.cachedFonts;
  }

  /**
   * Returns currently cached loaded fonts.
   */
  public getCachedFonts(): LoadedCustomFont[] {
    return this.cachedFonts;
  }

  /**
   * Adds a new font file to the persistent fonts storage using fast Base64 transfer.
   */
  public async addFontFile(file: File): Promise<LoadedCustomFont> {
    try {
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          const commaIdx = result.indexOf(',');
          resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
        };
        reader.onerror = (e) => reject(e);
        reader.readAsDataURL(file);
      });

      const info = await invoke<CustomFontInfo>('save_custom_font', {
        fileName: file.name,
        base64Data,
      });

      const loaded = await this.loadFont(info);
      
      // Update cache
      this.cachedFonts = this.cachedFonts.filter((f) => f.fileName !== loaded.fileName);
      this.cachedFonts.push(loaded);
      this.cachedFonts.sort((a, b) => a.name.localeCompare(b.name));
      this.notify();

      return loaded;
    } catch (err) {
      console.error('Failed to add custom font:', err);
      throw err;
    }
  }

  /**
   * Deletes a custom font by fileName or filePath.
   */
  public async deleteFont(fileName: string): Promise<boolean> {
    try {
      const success = await invoke<boolean>('delete_custom_font', { fileName });
      if (success) {
        for (const f of this.cachedFonts) {
          if (f.fileName === fileName || f.filePath === fileName) {
            this.registerFontFace(f.filePath, null);
          }
        }
        this.cachedFonts = this.cachedFonts.filter(
          (f) => f.fileName !== fileName && f.filePath !== fileName
        );
        this.notify();
      }
      return success;
    } catch (err) {
      console.error(`Failed to delete custom font '${fileName}':`, err);
      return false;
    }
  }

  /**
   * Opens the fonts folder in native file explorer.
   */
  public async openFontsFolder(): Promise<void> {
    try {
      await invoke('open_fonts_folder');
    } catch (err) {
      console.error('Failed to open fonts folder:', err);
    }
  }

  /**
   * Generates @font-face CSS definitions to be injected into foliate-js reader.
   */
  public generateFontsCss(fonts?: LoadedCustomFont[]): string {
    const list = fonts || this.cachedFonts;
    return list
      .filter((f) => f.dataUrl)
      .map(
        (f) => `
@font-face {
  font-family: '${f.fontFamily}';
  src: url('${f.dataUrl}') format('${f.format}');
  font-weight: 100 900;
  font-style: normal;
}
        `
      )
      .join('\n');
  }
}

export const fontManager = new FontManager();
