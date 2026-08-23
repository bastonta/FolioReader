export interface CustomFontInfo {
  id: string;
  name: string;
  fontFamily: string;
  filePath: string;
  fileName: string;
  format: 'truetype' | 'opentype' | 'woff' | 'woff2' | string;
  fileSize: number;
}

export interface LoadedCustomFont extends CustomFontInfo {
  dataUrl?: string;
  isLoaded?: boolean;
}
