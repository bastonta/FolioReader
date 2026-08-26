export interface BookMetadata {
  title: string;
  author: string;
  publisher?: string;
  language?: string;
  description?: string;
  identifier?: string;
  published?: string;
  modified?: string;
  subject?: string[] | string;
  coverUrl?: string;
}

export interface TOCItem {
  label: string;
  href: string;
  subitems?: TOCItem[];
}

export interface Annotation {
  id: string;
  bookId: string;
  value: string; // CFI string
  color: string; // Hex or CSS color
  style?: 'highlight' | 'underline' | 'squiggly' | 'strikethrough';
  text: string; // Highlighted text quote
  note?: string; // User's personal note
  createdAt: string;
  chapterTitle?: string;
  sectionIndex?: number;
}

export interface Bookmark {
  id: string;
  bookId: string;
  cfi: string;
  fraction: number;
  locationLabel?: string;
  chapterTitle?: string;
  textSnippet?: string;
  createdAt: string;
}

export interface RecentBook {
  id: string;
  title: string;
  author: string;
  coverUrl?: string;
  filePath?: string;
  lastLocation?: string; // CFI
  progressFraction: number;
  lastOpenedAt: string;
  fileName?: string;
  fileSize?: number;
}

export type ThemeName = 'light' | 'sepia' | 'gray' | 'dark' | 'solarized';

export type PageTurnMethod = 'tap' | 'swipe' | 'both';

export type ScreenTimeoutOption = 'system' | '2' | '5' | '10' | '15' | '30' | 'never';

export type Language = 'system' | 'en' | 'ru';

export interface ReaderSettings {
  flow: 'paginated' | 'scrolled';
  columns: 'auto' | 1 | 2;
  fontFamily: string;
  fontSize: number; // in pt or px, e.g. 18
  fontWeight?: number; // 300 - 900, e.g. 400
  spacing: number; // line-height, e.g. 1.5
  margin: number; // page margin in px
  justify: boolean;
  hyphenate: boolean;
  theme: ThemeName;
  language?: Language;
  pageTurnMethod?: PageTurnMethod;
  volumeKeysPageTurn?: boolean;
  volumeKeysInverted?: boolean;
  screenTimeout?: ScreenTimeoutOption;
  sidebarPinned: boolean;
  sidebarOpen: boolean;
  activeTab: 'contents' | 'annotations' | 'bookmarks';
  downloadPath?: string;
  createSeriesFolder?: boolean;
  libraryViewMode?: 'grid' | 'list';
}

export interface FootnoteData {
  title: string;
  contentHtml: string;
  href: string;
  target?: Element | null;
}

export const ANNOTATION_COLORS: Record<string, { label: string; bg: string; text: string; hex: string; border: string }> = {
  yellow: { label: 'Yellow', bg: 'bg-yellow-500/20', text: 'text-yellow-400', hex: '#eab308', border: 'border-yellow-500/40' },
  gray: { label: 'Gray', bg: 'bg-slate-500/20', text: 'text-slate-400', hex: '#64748b', border: 'border-slate-500/40' },
  blue: { label: 'Blue', bg: 'bg-blue-500/20', text: 'text-blue-400', hex: '#3b82f6', border: 'border-blue-500/40' },
  red: { label: 'Red', bg: 'bg-red-500/20', text: 'text-red-400', hex: '#ef4444', border: 'border-red-500/40' },
  green: { label: 'Green', bg: 'bg-emerald-500/20', text: 'text-emerald-400', hex: '#22c55e', border: 'border-emerald-500/40' },
  olive: { label: 'Olive', bg: 'bg-lime-600/20', text: 'text-lime-400', hex: '#84cc16', border: 'border-lime-600/40' },
  orange: { label: 'Orange', bg: 'bg-orange-500/20', text: 'text-orange-400', hex: '#f97316', border: 'border-orange-500/40' },
  purple: { label: 'Purple', bg: 'bg-purple-500/20', text: 'text-purple-400', hex: '#a855f7', border: 'border-purple-500/40' },
};

export type AnnotationColorKey = keyof typeof ANNOTATION_COLORS;

export const getAnnotationColorKey = (color?: string): string => {
  if (!color) return 'yellow';
  const lower = color.toLowerCase().trim();
  if (ANNOTATION_COLORS[lower]) return lower;
  if (lower === 'grey') return 'gray';
  for (const [key, val] of Object.entries(ANNOTATION_COLORS)) {
    if (val.hex.toLowerCase() === lower) return key;
  }
  return 'yellow';
};

export const getAnnotationColor = (color?: string) => {
  const key = getAnnotationColorKey(color);
  return ANNOTATION_COLORS[key] || ANNOTATION_COLORS.yellow;
};
