import { invoke } from '@tauri-apps/api/core';
import { CustomFontInfo, LoadedCustomFont } from '../types/font';

type FontChangeListener = (fonts: LoadedCustomFont[]) => void;

class FontManager {
  private cachedFonts: LoadedCustomFont[] = [];
  private listeners: Set<FontChangeListener> = new Set();
  private isInitialized = false;

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
        document.fonts.add(fontFace);
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
   * Initializes and loads all custom fonts from disk.
   */
  public async loadAllFonts(): Promise<LoadedCustomFont[]> {
    const list = await this.listFonts();
    const loaded = await Promise.all(list.map((f) => this.loadFont(f)));
    this.cachedFonts = loaded;
    this.isInitialized = true;
    this.notify();
    return loaded;
  }

  /**
   * Returns currently cached loaded fonts.
   */
  public getCachedFonts(): LoadedCustomFont[] {
    return this.cachedFonts;
  }

  /**
   * Adds a new font file to the persistent fonts storage.
   */
  public async addFontFile(file: File): Promise<LoadedCustomFont> {
    try {
      const buffer = await file.arrayBuffer();
      const bytes = Array.from(new Uint8Array(buffer));

      const info = await invoke<CustomFontInfo>('save_custom_font', {
        fileName: file.name,
        bytes,
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
