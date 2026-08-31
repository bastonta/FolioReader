import React, { useEffect, useRef, useState, useCallback } from 'react';
import '../../foliate-js/view.js';
import { Overlayer } from '../../foliate-js/overlayer.js';
import { RefreshCw } from 'lucide-react';
import {
  BookMetadata,
  TOCItem,
  Annotation,
  Bookmark,
  ReaderSettings,
  FootnoteData,
  getAnnotationColor,
  getAnnotationColorKey,
} from '../../types/reader';
import { formatPageLocationText } from '../../services/timeFormat';
import { Sidebar } from './Sidebar';
import { HeaderBar } from './HeaderBar';
import { ProgressScrubber } from './ProgressScrubber';
import { FootnoteModal } from './FootnoteModal';
import { AnnotationPopover, SelectionInfo } from './AnnotationPopover';
import { SettingsPopover } from './SettingsPopover';
import { BookInfoModal } from './BookInfoModal';
import { setStatusBarVisible, setStatusBarTheme, setDisableSystemActionMode, dismissOriginalContextMenu, isMobileDevice, setVolumeKeyNavigation, setKeepScreenOn } from '../../services/systemUi';
import { openExternalUrl } from '../../services/appOpener';
import { useBackHandler } from '../../services/backHandler';
import {
  saveLastLocation,
  storeBookCover,
  blobToThumbnailDataUrl,
  updateRecentBookMetadata,
  saveLocalBookCache,
  formatLanguageMap,
  formatContributor,
} from '../../services/storage';
import {
  loadDbLastLocation,
  saveDbLastLocation,
  loadDbBookmarks,
  saveDbBookmark,
  deleteDbBookmark,
  loadDbAnnotations,
  saveDbAnnotation,
  deleteDbAnnotation,
  syncBookData,
  pullBookProgress,
} from '../../services/readerDb';
import { fontManager } from '../../services/fontManager';
import { LoadedCustomFont } from '../../types/font';
import { useTranslation } from '../../i18n';
import { DevicePaginator, DevicePageInfo } from '../../services/devicePaginator';
import { useReadingTracker } from '../../services/useReadingTracker';

interface FoliateReaderProps {
  bookId: string;
  bookSource: File | Blob | string;
  settings: ReaderSettings;
  onUpdateSettings: (newSettings: Partial<ReaderSettings>) => void;
  onBackToLibrary: () => void;
}



export const isFootnoteOrEndnoteLink = (a: Element | null, href: string): boolean => {
  if (!a && !href) return false;
  const typeAttr =
    a?.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type') ||
    a?.getAttribute?.('epub:type') ||
    '';
  const roleAttr = a?.getAttribute?.('role') || '';
  const classAttr = a?.getAttribute?.('class') || '';

  const isNoteRefType = /\b(noteref|footnote|endnote|rearnote|note|biblioref|glossref|annotation)\b/i.test(typeAttr);
  const isNoteRefRole = /\b(doc-noteref|doc-footnote|doc-endnote|doc-biblioentry|doc-glossref)\b/i.test(roleAttr);
  const isNoteClass = /\b(footnote|endnote|noteref|footnote-ref|fn-ref|duokan-footnote|sdfootnoteanc|reference)\b/i.test(classAttr);

  if (isNoteRefType || isNoteRefRole || isNoteClass) return true;

  const isSup =
    a?.matches?.('sup, sub') ||
    a?.closest?.('sup, sub') !== null ||
    a?.querySelector?.('sup, sub') !== null;

  const hash = href.includes('#') ? href.split('#')[1] : '';
  if (hash) {
    const isNoteHash = /^(note|fn|footnote|endnote|rearnote|comment|n_|fn_|c_|ref_|annotation|sdfootnote|\d+)/i.test(hash);
    if (isNoteHash) return true;
  }

  const text = a?.textContent?.trim() || '';
  const isShortNoteText = /^(\[?\d+\]?|\(\d+\)|\*+|†|‡|\[[a-zA-Z]\]|\([a-zA-Z]\))$/i.test(text);

  if (isSup && (hash || isShortNoteText)) return true;
  if (isShortNoteText && hash) return true;

  return false;
};

export const extractFootnoteData = async (
  book: any,
  href: string,
  a?: Element | null
): Promise<FootnoteData | null> => {
  if (!book || !href) return null;
  try {
    const target = await Promise.resolve(book.resolveHref(href));
    if (!target) return null;

    const { index, anchor } = target;
    const section = book.sections?.[index];
    if (!section) return null;

    const doc = await section.createDocument();
    if (!doc) return null;

    let targetEl: HTMLElement | null = null;
    if (typeof anchor === 'function') {
      try {
        targetEl = anchor(doc);
      } catch (e) {
        console.warn('anchor(doc) error:', e);
      }
    }

    if (!targetEl && href.includes('#')) {
      const hash = href.split('#')[1];
      if (hash) {
        targetEl =
          doc.getElementById(hash) ||
          doc.querySelector(`[name="${hash}"]`) ||
          doc.querySelector(`[id="${CSS.escape(hash)}"]`) ||
          doc.querySelector(`a[name="${hash}"]`);
      }
    }

    if (!targetEl) return null;

    // If inline element, climb up to enclosing block
    let blockEl: HTMLElement = targetEl;
    const inlineTagNames = new Set(['A', 'SPAN', 'SUP', 'SUB', 'EM', 'STRONG', 'I', 'B', 'SMALL', 'BIG', 'FONT', 'TT']);
    while (
      blockEl.parentElement &&
      blockEl.parentElement !== doc.body &&
      inlineTagNames.has(blockEl.tagName.toUpperCase())
    ) {
      blockEl = blockEl.parentElement;
    }

    // Clone to sanitize/strip backlink anchors
    const clone = blockEl.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(
      'a[role*="doc-backlink"], a[epub\\:type*="backlink"], a[class*="backlink"], a[class*="return"], .footnote-back, .backlink'
    ).forEach((el) => el.remove());

    const contentHtml = clone.innerHTML.trim() || clone.textContent?.trim() || '';
    if (!contentHtml) return null;

    const linkText = a?.textContent?.trim() || '';
    const title = linkText ? `Note ${linkText}` : 'Note';

    return {
      title,
      contentHtml,
      href,
      target: targetEl,
    };
  } catch (err) {
    console.warn('Error extracting footnote data:', err);
    return null;
  }
};

const getReaderCSS = (settings: ReaderSettings, customFontsCss: string = '') => {
  const themeColors: Record<string, { bg: string; text: string; link: string }> = {
    light: { bg: '#ffffff', text: '#2e3436', link: '#1a5fb4' },
    sepia: { bg: '#fbf0d9', text: '#5f4b32', link: '#8f6b32' },
    gray: { bg: '#2e3440', text: '#eceff4', link: '#88c0d0' },
    dark: { bg: '#1e1e1e', text: '#e0e0e0', link: '#62a0ea' },
    solarized: { bg: '#fdf6e3', text: '#657b83', link: '#268bd2' },
  };

  const colors = themeColors[settings.theme] || themeColors.light;
  const baseWeight = settings.fontWeight || 400;
  const boldWeight = Math.min(900, Math.max(700, baseWeight + 200));

  return `
    ${customFontsCss}
    @namespace epub "http://www.idpf.org/2007/ops";
    *, *::before, *::after {
      -webkit-tap-highlight-color: transparent !important;
    }
    img, a {
      -webkit-user-drag: none;
      user-drag: none;
    }
    ::selection {
      background-color: ${colors.link}40 !important;
    }
    ::-moz-selection {
      background-color: ${colors.link}40 !important;
    }
    html {
      color-scheme: ${settings.theme === 'dark' || settings.theme === 'gray' ? 'dark' : 'light'};
      background-color: ${colors.bg} !important;
      -webkit-touch-callout: none !important;
    }
    body {
      font-family: ${settings.fontFamily} !important;
      font-size: ${settings.fontSize}px !important;
      font-weight: ${baseWeight} !important;
      line-height: ${settings.spacing} !important;
      background-color: ${colors.bg} !important;
      color: ${colors.text} !important;
      -webkit-touch-callout: none !important;
      user-select: text !important;
      -webkit-user-select: text !important;
      font-synthesis: weight style;
    }
    p, li, blockquote, dd {
      font-weight: ${baseWeight} !important;
      line-height: ${settings.spacing} !important;
      text-align: ${settings.justify ? 'justify' : 'start'} !important;
      -webkit-hyphens: ${settings.hyphenate ? 'auto' : 'manual'} !important;
      hyphens: ${settings.hyphenate ? 'auto' : 'manual'} !important;
      -webkit-hyphenate-limit-before: 3;
      -webkit-hyphenate-limit-after: 2;
      -webkit-hyphenate-limit-lines: 2;
      hanging-punctuation: allow-end last;
      widows: 2;
    }
    b, strong, th {
      font-weight: ${boldWeight} !important;
    }
    h1, h2, h3, h4, h5, h6 {
      font-weight: ${boldWeight} !important;
    }
    /* Prevent overriding explicit alignment */
    [align="left"] { text-align: left !important; }
    [align="right"] { text-align: right !important; }
    [align="center"] { text-align: center !important; }
    [align="justify"] { text-align: justify !important; }

    /* Code blocks formatting, wrap protection & disable justification */
    pre, code, kbd, samp, tt, var {
      text-align: start !important;
      -webkit-hyphens: none !important;
      hyphens: none !important;
      tab-size: 2;
    }
    pre {
      white-space: pre-wrap !important;
      word-break: break-word !important;
      overflow-wrap: break-word !important;
      box-sizing: border-box !important;
      max-width: 100% !important;
    }
    code {
      white-space: pre-wrap !important;
      word-break: break-word !important;
      overflow-wrap: break-word !important;
    }
    pre * {
      text-align: start !important;
      -webkit-hyphens: none !important;
      hyphens: none !important;
      white-space: pre-wrap !important;
      word-break: break-word !important;
      overflow-wrap: break-word !important;
    }
    a:link {
      color: ${colors.link};
    }
    sup, a[epub|type~="noteref"], a[role~="doc-noteref"] {
      color: #e02424;
      text-decoration: underline;
      text-underline-offset: 2px;
      cursor: pointer;
    }
    aside[epub|type~="endnote"],
    aside[epub|type~="footnote"],
    aside[epub|type~="note"],
    aside[epub|type~="rearnote"] {
      display: none;
    }
  `;
};

export const FoliateReader: React.FC<FoliateReaderProps> = ({
  bookId,
  bookSource,
  settings,
  onUpdateSettings,
  onBackToLibrary,
}) => {
  const { t } = useTranslation();
  const viewerContainerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<any>(null);
  const settingsRef = useRef(settings);

  // Hide system status bar (clock & battery) and suppress system ActionMode while reading
  useEffect(() => {
    setStatusBarVisible(false);
    setDisableSystemActionMode(true);
    // If sidebar is not pinned (on mobile or unpinned on desktop), ensure it starts closed on open
    const isMobileDeviceCheck = isMobileDevice();
    const isPinnedInitial = !isMobileDeviceCheck && settingsRef.current.sidebarPinned;
    if (!isPinnedInitial && settingsRef.current.sidebarOpen) {
      onUpdateSettings({ sidebarOpen: false });
    }
    return () => {
      setStatusBarVisible(true);
      setStatusBarTheme(settingsRef.current.theme);
      setDisableSystemActionMode(false);
      const isMobileDeviceCheck = isMobileDevice();
      const isPinnedExit = !isMobileDeviceCheck && settingsRef.current.sidebarPinned;
      if (!isPinnedExit) {
        onUpdateSettings({ sidebarOpen: false });
      }
    };
  }, []);

  useEffect(() => {
    const isMobileDeviceCheck = isMobileDevice();
    const isPinnedCurrent = !isMobileDeviceCheck && settingsRef.current.sidebarPinned;
    if (!isPinnedCurrent && settingsRef.current.sidebarOpen) {
      onUpdateSettings({ sidebarOpen: false });
    }
  }, [bookId]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const [showControls, setShowControls] = useState<boolean>(true);
  const isMobile = isMobileDevice();
  const isPinned = !isMobile && settings.sidebarPinned;
  const [metadata, setMetadata] = useState<BookMetadata | null>(null);
  const [toc, setTOC] = useState<TOCItem[]>([]);
  const [currentHref, setCurrentHref] = useState<string | null>(null);
  const [chapterTitle, setChapterTitle] = useState<string>('');
  const [locationLabel, setLocationLabel] = useState<string>('');
  const [pageInfo, setPageInfo] = useState<DevicePageInfo | null>(null);
  const [progressFraction, setProgressFraction] = useState<number>(0);
  const [sectionFractions, setSectionFractions] = useState<number[]>([]);
  const [currentCFI, setCurrentCFI] = useState<string>('');
  const paginatorRef = useRef<DevicePaginator | null>(null);

  const { stats: readingStats, recordPageTurn } = useReadingTracker({
    bookId,
    currentFraction: progressFraction,
  });
  const readingStatsRef = useRef(readingStats);
  readingStatsRef.current = readingStats;

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const annotationsRef = useRef<Annotation[]>(annotations);
  const updateAnnotations = useCallback((anns: Annotation[]) => {
    annotationsRef.current = anns;
    setAnnotations(anns);
  }, []);

  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const bookmarksRef = useRef<Bookmark[]>(bookmarks);
  const updateBookmarks = useCallback((bms: Bookmark[]) => {
    bookmarksRef.current = bms;
    setBookmarks(bms);
  }, []);

  const [footnote, setFootnote] = useState<FootnoteData | null>(null);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const selectionRef = useRef<SelectionInfo | null>(null);
  selectionRef.current = selection;

  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [isBookInfoOpen, setIsBookInfoOpen] = useState<boolean>(false);
  const [customFonts, setCustomFonts] = useState<LoadedCustomFont[]>(() => fontManager.getCachedFonts());
  const isInitialLoadRef = useRef<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncToast, setSyncToast] = useState<{ message: string; type?: 'info' | 'success' | 'error' } | null>(null);

  const settingsBtnRef = useRef<HTMLButtonElement>(null);

  // Subscribe to custom fonts updates
  useEffect(() => {
    fontManager.loadAllFonts().then(setCustomFonts);
    const unsubscribe = fontManager.subscribe(setCustomFonts);
    return () => unsubscribe();
  }, []);

  // Back button handling within the reader (highest to lowest priority)
  useBackHandler(() => { setFootnote(null); return true; }, Boolean(footnote), 120);
  useBackHandler(() => { setIsBookInfoOpen(false); return true; }, isBookInfoOpen, 110);
  useBackHandler(() => { setSelection(null); return true; }, Boolean(selection), 100);
  useBackHandler(() => { setIsSettingsOpen(false); return true; }, isSettingsOpen, 90);
  useBackHandler(() => { onUpdateSettings({ sidebarOpen: false }); return true; }, Boolean(settings.sidebarOpen), 80);
  useBackHandler(() => { onBackToLibrary(); return true; }, true, 30);

  const showSyncToast = useCallback(
    (message: string, type: 'info' | 'success' | 'error' = 'info') => {
      setSyncToast({ message, type });
      setSyncMessage(message);
      setTimeout(() => {
        setSyncToast((prev) => (prev?.message === message ? null : prev));
      }, 3500);
    },
    []
  );

  const handleSyncProgress = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    try {
      const [progressResult, syncResult] = await Promise.all([
        pullBookProgress(bookId),
        syncBookData(bookId),
      ]);

      if (progressResult?.success && progressResult.location) {
        const pct = Math.round(progressResult.progressPercent || 0);
        if (viewRef.current) {
          await viewRef.current.goTo(progressResult.location);
        }
        showSyncToast(t('reader.syncSuccess', { percent: pct }), 'success');
      } else if (progressResult?.message) {
        showSyncToast(progressResult.message, progressResult.success ? 'success' : 'info');
      } else {
        showSyncToast(t('reader.syncUpToDate'), 'info');
      }

      // Refresh annotations & bookmarks if synced
      if (syncResult && (syncResult.bookmarksSynced > 0 || syncResult.annotationsSynced > 0)) {
        const [syncedAnns, syncedBms] = await Promise.all([
          loadDbAnnotations(bookId),
          loadDbBookmarks(bookId),
        ]);
        updateAnnotations(syncedAnns);
        updateBookmarks(syncedBms);
        if (viewRef.current) {
          for (const ann of syncedAnns) {
            viewRef.current.addAnnotation(ann);
          }
        }
      }
    } catch (err: any) {
      console.error('Failed to sync progress:', err);
      showSyncToast(t('reader.syncFailed', { error: err?.message || err }), 'error');
    } finally {
      setIsSyncing(false);
    }
  }, [bookId, isSyncing, showSyncToast, t, updateAnnotations, updateBookmarks]);

  // Automatically sync book when reconnecting online
  useEffect(() => {
    const handleOnline = () => {
      syncBookData(bookId).catch(console.warn);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('folio:connection-restored', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('folio:connection-restored', handleOnline);
    };
  }, [bookId]);

  // Refs for tracking active modal/hover state inside timer callbacks
  const isSettingsOpenRef = useRef(isSettingsOpen);
  useEffect(() => {
    isSettingsOpenRef.current = isSettingsOpen;
  }, [isSettingsOpen]);

  const isBookInfoOpenRef = useRef(isBookInfoOpen);
  useEffect(() => {
    isBookInfoOpenRef.current = isBookInfoOpen;
  }, [isBookInfoOpen]);

  const footnoteRef = useRef(footnote);
  useEffect(() => {
    footnoteRef.current = footnote;
  }, [footnote]);

  const isHoveringControlsRef = useRef(false);
  const autoHideTimerRef = useRef<number | null>(null);

  const showControlsRef = useRef(showControls);
  useEffect(() => {
    showControlsRef.current = showControls;
  }, [showControls]);

  const cancelAutoHide = useCallback(() => {
    if (autoHideTimerRef.current) {
      clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = null;
    }
  }, []);

  const scheduleAutoHide = useCallback(() => {
    cancelAutoHide();
    autoHideTimerRef.current = window.setTimeout(() => {
      if (
        !isHoveringControlsRef.current &&
        !isSettingsOpenRef.current &&
        !isBookInfoOpenRef.current &&
        !footnoteRef.current &&
        !selectionRef.current &&
        (!settingsRef.current.sidebarOpen || (!isMobile && settingsRef.current.sidebarPinned))
      ) {
        setShowControls(false);
      }
    }, 3500);
  }, [cancelAutoHide]);

  const scheduleAutoHideRef = useRef(scheduleAutoHide);
  useEffect(() => {
    scheduleAutoHideRef.current = scheduleAutoHide;
  }, [scheduleAutoHide]);

  const cancelAutoHideRef = useRef(cancelAutoHide);
  useEffect(() => {
    cancelAutoHideRef.current = cancelAutoHide;
  }, [cancelAutoHide]);

  // Manage auto-hide timer when showControls changes
  useEffect(() => {
    if (showControls) {
      scheduleAutoHide();
    } else {
      cancelAutoHide();
    }
    return () => cancelAutoHide();
  }, [showControls, scheduleAutoHide, cancelAutoHide]);

  // Window mouse movement for top/bottom edge triggers & activity reset
  useEffect(() => {
    const handleWindowMouseMove = (e: MouseEvent) => {
      if (!showControls) {
        // User moves mouse near top or bottom edge -> reveal controls
        if (e.clientY <= 36 || e.clientY >= window.innerHeight - 36) {
          setShowControls(true);
          scheduleAutoHide();
        }
      } else {
        if (!isHoveringControlsRef.current) {
          scheduleAutoHide();
        }
      }
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    return () => window.removeEventListener('mousemove', handleWindowMouseMove);
  }, [showControls, scheduleAutoHide]);

  // Screen Timeout Management (Keep Screen On / Inactivity Screen Sleep)
  const screenTimeoutTimerRef = useRef<number | null>(null);
  const isScreenAwakeRef = useRef<boolean>(false);

  const resetScreenTimeout = useCallback(() => {
    const timeoutSetting = settings.screenTimeout || '5';

    if (screenTimeoutTimerRef.current) {
      window.clearTimeout(screenTimeoutTimerRef.current);
      screenTimeoutTimerRef.current = null;
    }

    if (timeoutSetting === 'system') {
      if (isScreenAwakeRef.current) {
        setKeepScreenOn(false);
        isScreenAwakeRef.current = false;
      }
      return;
    }

    if (timeoutSetting === 'never') {
      if (!isScreenAwakeRef.current) {
        setKeepScreenOn(true);
        isScreenAwakeRef.current = true;
      }
      return;
    }

    const minutes = parseInt(timeoutSetting, 10);
    if (isNaN(minutes) || minutes <= 0) {
      if (isScreenAwakeRef.current) {
        setKeepScreenOn(false);
        isScreenAwakeRef.current = false;
      }
      return;
    }

    if (!isScreenAwakeRef.current) {
      setKeepScreenOn(true);
      isScreenAwakeRef.current = true;
    }

    screenTimeoutTimerRef.current = window.setTimeout(() => {
      setKeepScreenOn(false);
      isScreenAwakeRef.current = false;
    }, minutes * 60 * 1000);
  }, [settings.screenTimeout]);

  const resetScreenTimeoutRef = useRef(resetScreenTimeout);
  useEffect(() => {
    resetScreenTimeoutRef.current = resetScreenTimeout;
  }, [resetScreenTimeout]);

  // Synchronize screen timeout on setting change & app visibility
  useEffect(() => {
    resetScreenTimeout();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (screenTimeoutTimerRef.current) {
          window.clearTimeout(screenTimeoutTimerRef.current);
          screenTimeoutTimerRef.current = null;
        }
        setKeepScreenOn(false);
        isScreenAwakeRef.current = false;
      } else {
        resetScreenTimeout();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (screenTimeoutTimerRef.current) {
        window.clearTimeout(screenTimeoutTimerRef.current);
        screenTimeoutTimerRef.current = null;
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      setKeepScreenOn(false);
      isScreenAwakeRef.current = false;
    };
  }, [resetScreenTimeout]);

  // Window activity listeners for screen timeout reset
  useEffect(() => {
    const handleActivity = () => {
      resetScreenTimeoutRef.current();
    };

    window.addEventListener('pointerdown', handleActivity, { passive: true });
    window.addEventListener('touchstart', handleActivity, { passive: true });
    window.addEventListener('keydown', handleActivity, { passive: true });
    window.addEventListener('wheel', handleActivity, { passive: true });

    return () => {
      window.removeEventListener('pointerdown', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('wheel', handleActivity);
    };
  }, []);

  // Hardware Volume Keys Navigation for Android
  useEffect(() => {
    const isVolumeEnabled = settings.volumeKeysPageTurn !== false;
    setVolumeKeyNavigation(isVolumeEnabled);

    const handleVolumeKey = (direction: 'up' | 'down') => {
      resetScreenTimeoutRef.current();

      const isInverted = settings.volumeKeysInverted === true;
      const goForward = isInverted ? direction === 'up' : direction === 'down';

      if (goForward) {
        viewRef.current?.goRight();
      } else {
        viewRef.current?.goLeft();
      }

      if (showControlsRef.current) {
        scheduleAutoHideRef.current();
      }
    };

    (window as any).handleAndroidVolumeKey = handleVolumeKey;

    return () => {
      setVolumeKeyNavigation(false);
      if ((window as any).handleAndroidVolumeKey === handleVolumeKey) {
        delete (window as any).handleAndroidVolumeKey;
      }
    };
  }, [settings.volumeKeysPageTurn, settings.volumeKeysInverted]);

  // Update running feet marginals inside foliate-view
  const updateRunningFooter = useCallback((info: DevicePageInfo) => {
    try {
      const feet = viewRef.current?.renderer?.feet;
      if (Array.isArray(feet) && feet.length > 0) {
        const mode = settingsRef.current.footerDisplayMode || 'pages';
        const secondsPerPage = readingStatsRef.current?.averageSecondsPerPage && readingStatsRef.current.averageSecondsPerPage > 0
          ? readingStatsRef.current.averageSecondsPerPage
          : 60;
        const text = formatPageLocationText(info, mode, secondsPerPage, t);
        for (const foot of feet) {
          if (foot) {
            foot.textContent = text;
            foot.onclick = null;
            foot.style.cursor = '';
          }
        }
      }
    } catch (e) {
      console.warn('Error updating running feet:', e);
    }
  }, [t]);

  // Re-render running feet and location label whenever footerDisplayMode or reading stats change
  useEffect(() => {
    if (pageInfo) {
      updateRunningFooter(pageInfo);
      const secondsPerPage = readingStats?.averageSecondsPerPage && readingStats.averageSecondsPerPage > 0
        ? readingStats.averageSecondsPerPage
        : 60;
      const fullLocText = formatPageLocationText(pageInfo, settings.footerDisplayMode || 'pages', secondsPerPage, t);
      setLocationLabel(fullLocText);
    }
  }, [settings.footerDisplayMode, pageInfo, updateRunningFooter, readingStats?.averageSecondsPerPage, t]);

  // Initialize or re-initialize screen-dependent device pagination
  const initDevicePaginator = useCallback(() => {
    if (!viewRef.current?.book) return;

    const customFontsCss = fontManager.generateFontsCss(customFonts);
    const readerCSS = getReaderCSS(settings, customFontsCss);
    const viewerRect = viewerContainerRef.current?.getBoundingClientRect();
    const width = viewerRect?.width || window.innerWidth;
    const height = viewerRect?.height || window.innerHeight;

    paginatorRef.current?.destroy();

    const paginator = new DevicePaginator(
      bookId,
      viewRef.current.book,
      {
        width,
        height,
        flow: settings.flow,
        columns: settings.columns,
        fontSize: settings.fontSize,
        fontFamily: settings.fontFamily,
        spacing: settings.spacing,
        margin: settings.margin,
        readerCSS,
      },
      (p) => {
        const lastLoc = (viewRef.current as any)?.lastLocation;
        if (lastLoc) {
          const secIdx = lastLoc.index ?? lastLoc.section?.current ?? 0;
          const page = lastLoc.page ?? 1;
          const pages = lastLoc.pages ?? 3;
          const frac = lastLoc.fraction ?? 0;
          const info = p.getPageInfo(secIdx, page, pages, frac);
          setPageInfo(info);
          updateRunningFooter(info);
        }
      }
    );

    paginatorRef.current = paginator;
    paginator.startBackgroundMeasurement();

    const lastLoc = (viewRef.current as any)?.lastLocation;
    if (lastLoc) {
      const secIdx = lastLoc.index ?? lastLoc.section?.current ?? 0;
      const page = lastLoc.page ?? 1;
      const pages = lastLoc.pages ?? 3;
      const frac = lastLoc.fraction ?? 0;
      paginator.updateLiveSection(secIdx, page, pages);
      const info = paginator.getPageInfo(secIdx, page, pages, frac);
      setPageInfo(info);
      updateRunningFooter(info);
    }
  }, [bookId, customFonts, settings, updateRunningFooter]);

  // Update styling in foliate-view
  const applyStyles = useCallback(() => {
    if (viewRef.current?.renderer) {
      const customFontsCss = fontManager.generateFontsCss(customFonts);
      viewRef.current.renderer.setStyles?.(getReaderCSS(settings, customFontsCss));
      viewRef.current.renderer.setAttribute?.('flow', settings.flow);
      
      const isMobile = isMobileDevice();
      const method = settings.pageTurnMethod || 'both';
      const allowSwipe = isMobile && (method === 'swipe' || method === 'both');
      viewRef.current.renderer.setAttribute?.('touch-swipe', allowSwipe ? 'true' : 'false');
      if ('touchSwipeEnabled' in viewRef.current.renderer) {
        viewRef.current.renderer.touchSwipeEnabled = allowSwipe;
      }

      const colCount =
        settings.columns === 'auto'
          ? window.innerWidth > 1000
            ? '2'
            : '1'
          : String(settings.columns);
      viewRef.current.renderer.setAttribute?.('max-column-count', colCount);
      viewRef.current.renderer.setAttribute?.('margin', `${settings.margin}px`);
      viewRef.current.renderer.setAttribute?.('gap', '6%');

      initDevicePaginator();
    }
  }, [settings, customFonts, initDevicePaginator]);

  useEffect(() => {
    applyStyles();
  }, [applyStyles]);

  // Observe container resizing for accurate pagination recalibration
  useEffect(() => {
    if (!viewerContainerRef.current) return;
    let resizeTimer: any;
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        initDevicePaginator();
      }, 250);
    });
    observer.observe(viewerContainerRef.current);
    return () => {
      clearTimeout(resizeTimer);
      observer.disconnect();
    };
  }, [initDevicePaginator]);

  // Helper to determine viewport offset for iframe contents
  const getViewportOffset = useCallback((targetDoc?: Document) => {
    const viewRect = viewerContainerRef.current?.getBoundingClientRect() || { top: 0, left: 0 };
    const iframe = (targetDoc?.defaultView?.frameElement as HTMLElement) || null;
    const frameRect = iframe?.getBoundingClientRect();
    return {
      left: frameRect ? frameRect.left : viewRect.left,
      top: frameRect ? frameRect.top : viewRect.top,
    };
  }, []);

  // Helper to clear text selections across all reader documents
  const clearAllSelections = useCallback(() => {
    try {
      dismissOriginalContextMenu();
      const contents = viewRef.current?.renderer?.getContents() || [];
      for (const item of contents) {
        item.doc?.defaultView?.getSelection()?.removeAllRanges();
      }
      window.getSelection()?.removeAllRanges();
    } catch (e) {
      console.warn('Error clearing selection:', e);
    }
  }, []);

  // Initialize and load book
  useEffect(() => {
    let isCancelled = false;

    async function initBook() {
      if (!viewerContainerRef.current) return;

      // Clean up previous view
      if (viewRef.current) {
        viewRef.current.close?.();
        viewRef.current.remove();
        viewRef.current = null;
      }

      viewerContainerRef.current.replaceChildren();

      // Create new foliate-view web component
      const view = document.createElement('foliate-view') as any;
      view.classList.add('foliate-host-element');
      viewerContainerRef.current.appendChild(view);
      viewRef.current = view;

      // Register event listeners before opening/navigating to ensure initial page events are captured
      // Listen for relocate events
      view.addEventListener('relocate', (e: any) => {
        const detail = e.detail || {};
        const fraction = detail.fraction ?? 0;
        setProgressFraction(fraction);

        if (detail.cfi) {
          setCurrentCFI(detail.cfi);
          saveLastLocation(bookId, detail.cfi, fraction);
          if (!isInitialLoadRef.current) {
            saveDbLastLocation(bookId, detail.cfi, fraction);
            recordPageTurn();
          }
        }

        if (detail.tocItem) {
          setCurrentHref(detail.tocItem.href);
          setChapterTitle(detail.tocItem.label || '');
        }

        const sectionIndex = detail.index ?? detail.section?.current ?? 0;
        const page = detail.page ?? 1;
        const pages = detail.pages ?? 3;

        paginatorRef.current?.updateLiveSection(sectionIndex, page, pages);

        const info = paginatorRef.current?.getPageInfo(sectionIndex, page, pages, fraction) || {
          bookPage: Math.max(1, Math.round(fraction * 100)),
          totalBookPages: 100,
          chapterPage: Math.max(1, page),
          totalChapterPages: Math.max(1, pages > 2 ? pages - 2 : pages),
          percent: Math.round(fraction * 100),
          isEstimated: false,
          sectionIndex,
        };

        setPageInfo(info);
        updateRunningFooter(info);

        const secondsPerPage = readingStatsRef.current?.averageSecondsPerPage && readingStatsRef.current.averageSecondsPerPage > 0
          ? readingStatsRef.current.averageSecondsPerPage
          : 60;
        const fullLocText = formatPageLocationText(info, settingsRef.current.footerDisplayMode || 'pages', secondsPerPage, t);
        setLocationLabel(fullLocText);
      });

      // Footnote / Endnote interception & external link handling on link events
      view.addEventListener('link', async (e: any) => {
        const { a, href } = e.detail || {};
        if (href && (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:'))) {
          e.preventDefault();
          openExternalUrl(href);
          return;
        }
        if (isFootnoteOrEndnoteLink(a, href)) {
          e.preventDefault();
          const noteData = await extractFootnoteData(view.book, href, a);
          if (noteData) {
            setFootnote(noteData);
          } else {
            view.goTo(href);
          }
        }
      });

      // Listen for section load to attach selection, contextmenu, and keyboard handlers
      view.addEventListener('load', (e: any) => {
        const { doc, index } = e.detail;

        let selectionDismissedOnPointerDown = false;
        let pointerStartX = 0;
        let pointerStartY = 0;
        let pointerMoved = false;

        // Pointerdown / mousedown on free space inside doc dismisses popover & selection
        doc.addEventListener('pointerdown', (ev: PointerEvent) => {
          resetScreenTimeoutRef.current();
          pointerStartX = ev.clientX;
          pointerStartY = ev.clientY;
          pointerMoved = false;
          dismissOriginalContextMenu();
          if (selectionRef.current) {
            const contents = view.renderer?.getContents() || [];
            const currentContent = contents.find((c: any) => c.index === index && c.overlayer);
            const [val] = currentContent?.overlayer?.hitTest({ x: ev.clientX, y: ev.clientY }) || [];
            if (!val) {
              selectionDismissedOnPointerDown = true;
              setSelection(null);
              doc.defaultView?.getSelection()?.removeAllRanges();
            }
          }
        });

        doc.addEventListener('pointermove', (ev: PointerEvent) => {
          if (Math.hypot(ev.clientX - pointerStartX, ev.clientY - pointerStartY) > 12) {
            pointerMoved = true;
          }
        });

        doc.addEventListener('pointerup', (ev: PointerEvent) => {
          if (pointerMoved) {
            const iframe = (doc.defaultView?.frameElement as HTMLElement) || null;
            const frameTop = iframe ? iframe.getBoundingClientRect().top : 0;
            const startScreenY = frameTop + pointerStartY;
            const endScreenY = frameTop + ev.clientY;
            const winHeight = window.innerHeight;
            const sat = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sat') || '0', 10) || 0;
            const sab = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sab') || '0', 10) || 0;
            const topDeadzone = Math.max(84, 62 + sat);
            const bottomDeadzone = Math.max(84, 62 + sab);

            // If swipe started or ended in top or bottom deadzone, reveal controls
            if (startScreenY <= topDeadzone || startScreenY >= (winHeight - bottomDeadzone) ||
                endScreenY <= topDeadzone || endScreenY >= (winHeight - bottomDeadzone)) {
              if (!showControlsRef.current) {
                setShowControls(true);
                scheduleAutoHideRef.current();
              }
            }
          }
        });

        // Mouse move inside iframe for edge reveal & activity reset
        doc.addEventListener('mousemove', (ev: MouseEvent) => {
          if (!showControlsRef.current) {
            const clientY = ev.clientY;
            const docHeight = doc.defaultView?.innerHeight || window.innerHeight;
            if (clientY <= 36 || clientY >= docHeight - 36) {
              setShowControls(true);
              scheduleAutoHideRef.current();
            }
          } else {
            if (!isHoveringControlsRef.current) {
              scheduleAutoHideRef.current();
            }
          }
        });

        // Keyboard navigation inside iframe
        doc.addEventListener('keydown', (ev: KeyboardEvent) => {
          resetScreenTimeoutRef.current();
          if (ev.key === 'ArrowLeft' || ev.key === 'h') {
            view.goLeft();
            if (showControlsRef.current) scheduleAutoHideRef.current();
          } else if (ev.key === 'ArrowRight' || ev.key === 'l' || ev.key === ' ') {
            view.goRight();
            if (showControlsRef.current) scheduleAutoHideRef.current();
          } else if (ev.key === 'Escape') {
            if (selectionRef.current) {
              setSelection(null);
              clearAllSelections();
              return;
            }
            if (footnoteRef.current) {
              setFootnote(null);
              return;
            }
            if ((isMobile || !settingsRef.current.sidebarPinned) && settingsRef.current.sidebarOpen) {
              onUpdateSettings({ sidebarOpen: false });
              return;
            }
            setShowControls((prev) => {
              const next = !prev;
              if (next) scheduleAutoHideRef.current();
              else cancelAutoHideRef.current();
              return next;
            });
          } else if (ev.key === 'm' || ev.key === 'M') {
            setShowControls((prev) => {
              const next = !prev;
              if (next) scheduleAutoHideRef.current();
              else cancelAutoHideRef.current();
              return next;
            });
          }
        });

        // Context menu replacement & integration (Desktop right-click / Touch long press)
        doc.addEventListener('contextmenu', (ev: MouseEvent) => {
          ev.preventDefault();
          ev.stopPropagation();

          // 1. Check if right-clicking on an existing annotation
          const contents = view.renderer?.getContents() || [];
          const currentContent = contents.find((c: any) => c.index === index && c.overlayer);
          const overlayer = currentContent?.overlayer;
          let hitAnnotationCfi: string | null = null;
          let hitRange: Range | null = null;

          if (overlayer) {
            const [val, rng] = overlayer.hitTest({ x: ev.clientX, y: ev.clientY });
            if (val) {
              hitAnnotationCfi = val;
              hitRange = rng;
            }
          }

          if (hitAnnotationCfi) {
            const ann = annotationsRef.current.find((a) => a.value === hitAnnotationCfi);
            if (ann) {
              const offset = getViewportOffset(doc);
              const rangeRect = hitRange?.getBoundingClientRect() || {
                left: ev.clientX,
                top: ev.clientY,
                width: 0,
                height: 20,
              };
              setSelection({
                text: ann.text,
                cfi: ann.value,
                sectionIndex: index,
                rect: {
                  x: offset.left + rangeRect.left,
                  y: offset.top + rangeRect.top,
                  width: rangeRect.width,
                  height: rangeRect.height,
                },
                existingAnnotation: ann,
              });
              return;
            }
          }

          // 2. Check if there is an active text selection in doc
          const sel = doc.defaultView?.getSelection();
          if (sel && !sel.isCollapsed && sel.toString().trim()) {
            const text = sel.toString().trim();
            if (text.length > 0) {
              const range = sel.getRangeAt(0);
              const cfi = view.getCFI(index, range);
              const existing = annotationsRef.current.find((a) => a.value === cfi);
              const rangeRect = range.getBoundingClientRect();
              const offset = getViewportOffset(doc);
              setSelection({
                text,
                cfi,
                sectionIndex: index,
                rect: {
                  x: offset.left + rangeRect.left,
                  y: offset.top + rangeRect.top,
                  width: rangeRect.width,
                  height: rangeRect.height,
                },
                existingAnnotation: existing,
              });
              return;
            }
          }

          // 3. Right-click on unselected text -> expand to word
          let targetRange: Range | null = null;
          if ((doc as any).caretRangeFromPoint) {
            targetRange = (doc as any).caretRangeFromPoint(ev.clientX, ev.clientY);
          } else if ((doc as any).caretPositionFromPoint) {
            const pos = (doc as any).caretPositionFromPoint(ev.clientX, ev.clientY);
            if (pos?.offsetNode) {
              const r = doc.createRange();
              r.setStart(pos.offsetNode, pos.offset);
              r.collapse(true);
              targetRange = r;
            }
          }

          if (targetRange && targetRange.startContainer.nodeType === Node.TEXT_NODE) {
            const textNode = targetRange.startContainer as Text;
            const textContent = textNode.textContent || '';
            const offset = targetRange.startOffset;

            let start = offset;
            while (start > 0 && !/\s|[.,/#!$%^&*;:{}=\-_`~()«»""'']/.test(textContent[start - 1])) {
              start--;
            }
            let end = offset;
            while (end < textContent.length && !/\s|[.,/#!$%^&*;:{}=\-_`~()«»""'']/.test(textContent[end])) {
              end++;
            }

            if (end > start) {
              const wordRange = doc.createRange();
              wordRange.setStart(textNode, start);
              wordRange.setEnd(textNode, end);
              const wordText = wordRange.toString().trim();
              if (wordText) {
                const selObj = doc.defaultView?.getSelection();
                selObj?.removeAllRanges();
                selObj?.addRange(wordRange);

                const cfi = view.getCFI(index, wordRange);
                const existing = annotationsRef.current.find((a) => a.value === cfi);
                const rangeRect = wordRange.getBoundingClientRect();
                const offsetPos = getViewportOffset(doc);

                setSelection({
                  text: wordText,
                  cfi,
                  sectionIndex: index,
                  rect: {
                    x: offsetPos.left + rangeRect.left,
                    y: offsetPos.top + rangeRect.top,
                    width: rangeRect.width,
                    height: rangeRect.height,
                  },
                  existingAnnotation: existing,
                });
                return;
              }
            }
          }

          // 4. Right-click on empty space -> dismiss popover
          setSelection(null);
          clearAllSelections();
        });

        // Text selection for highlights & annotations (mouse drag / touch selection)
        doc.addEventListener('pointerup', () => {
          setTimeout(() => {
            const sel = doc.defaultView?.getSelection();
            if (sel && !sel.isCollapsed && sel.toString().trim()) {
              const text = sel.toString().trim();
              if (text.length > 0) {
                const range = sel.getRangeAt(0);
                const cfi = view.getCFI(index, range);
                const rangeRect = range.getBoundingClientRect();
                const offset = getViewportOffset(doc);
                const existing = annotationsRef.current.find((a) => a.value === cfi);

                setSelection({
                  text,
                  cfi,
                  sectionIndex: index,
                  rect: {
                    x: offset.left + rangeRect.left,
                    y: offset.top + rangeRect.top,
                    width: rangeRect.width,
                    height: rangeRect.height,
                  },
                  existingAnnotation: existing,
                });
              }
            }
          }, 20);
        });

        // Click handler inside iframe: footnote opening, unpinned sidebar dismissal, controls toggle & mobile tap navigation
        doc.addEventListener('click', async (ev: MouseEvent) => {
          // If the user was dragging/swiping or selecting text, do not treat as a tap
          if (pointerMoved) {
            pointerMoved = false;
            return;
          }

          // 1. If selection was dismissed on pointerdown, do not toggle controls or turn pages
          if (selectionDismissedOnPointerDown) {
            selectionDismissedOnPointerDown = false;
            return;
          }

          // 2. Unpinned sidebar dismissal
          if ((isMobile || !settingsRef.current.sidebarPinned) && settingsRef.current.sidebarOpen) {
            onUpdateSettings({ sidebarOpen: false });
            return;
          }

          // 3. Footnote / endnote / external link click
          const a = (ev.target as Element)?.closest('a[href]');
          if (a) {
            const href = a.getAttribute('href') || '';
            if (href && (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:'))) {
              ev.preventDefault();
              ev.stopPropagation();
              openExternalUrl(href);
              return;
            }
            if (isFootnoteOrEndnoteLink(a, href)) {
              ev.preventDefault();
              ev.stopPropagation();
              const noteData = await extractFootnoteData(view.book, href, a);
              if (noteData) {
                setFootnote(noteData);
              } else {
                view.goTo(href);
              }
            }
            return;
          }

          // 4. If an annotation was clicked (overlayer hit test), view.js emits show-annotation
          const contents = view.renderer?.getContents() || [];
          const currentContent = contents.find((c: any) => c.index === index && c.overlayer);
          const [val] = currentContent?.overlayer?.hitTest({ x: ev.clientX, y: ev.clientY }) || [];
          if (val) {
            return;
          }

          // 5. If settings popover is open, dismiss it on tap
          if (isSettingsOpenRef.current) {
            setIsSettingsOpen(false);
            return;
          }

          // 6. Clean click without text selection
          const sel = doc.defaultView?.getSelection();
          if (!sel || sel.isCollapsed || !sel.toString().trim()) {
            const isMobile = isMobileDevice();
            const method = settingsRef.current.pageTurnMethod || 'both';
            const allowTapTurn = isMobile && (method === 'tap' || method === 'both');

            if (allowTapTurn) {
              if (showControlsRef.current) {
                // If controls are visible, tapping hides controls
                setShowControls(false);
                cancelAutoHideRef.current();
              } else {
                // If controls are hidden, use 30% back / 70% forward with center/top reveal
                const viewerRect = viewerContainerRef.current?.getBoundingClientRect() || {
                  left: 0,
                  top: 0,
                  width: window.innerWidth,
                  height: window.innerHeight,
                };
                const iframe = (doc.defaultView?.frameElement as HTMLElement) || null;
                const frameRect = iframe ? iframe.getBoundingClientRect() : { left: 0, top: 0 };

                const tapScreenX = frameRect.left + ev.clientX - viewerRect.left;
                const tapScreenY = frameRect.top + ev.clientY - viewerRect.top;

                const screenWidth = viewerRect.width || window.innerWidth;
                const screenHeight = viewerRect.height || window.innerHeight;

                const xRatio = tapScreenX / screenWidth;
                const yRatio = tapScreenY / screenHeight;

                const sat = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sat') || '0', 10) || 0;
                const sab = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sab') || '0', 10) || 0;
                const topDeadzone = Math.max(84, 62 + sat);
                const bottomDeadzone = Math.max(84, 62 + sab);

                const isCenterTap = xRatio >= 0.35 && xRatio <= 0.65 && yRatio >= 0.35 && yRatio <= 0.65;
                const isTopBarTap = tapScreenY <= topDeadzone;
                const isBottomBarTap = tapScreenY >= (screenHeight - bottomDeadzone);

                if (isCenterTap || isTopBarTap || isBottomBarTap) {
                  setShowControls(true);
                  scheduleAutoHideRef.current();
                } else if (xRatio <= 0.30) {
                  // Left 30% goes back
                  view.goLeft();
                } else {
                  // Remaining 70% goes forward
                  view.goRight();
                }
              }
            } else {
              // Desktop or Mobile with swipe-only -> toggle controls
              setShowControls((prev) => {
                const next = !prev;
                if (next) scheduleAutoHideRef.current();
                else cancelAutoHideRef.current();
                return next;
              });
            }
          }
        });
      });

      // Overlay & Annotation rendering
      view.addEventListener('create-overlay', () => {
        const currentAnns = annotationsRef.current;
        for (const ann of currentAnns) {
          view.addAnnotation(ann);
        }
      });

      view.addEventListener('draw-annotation', (e: any) => {
        const { draw, annotation } = e.detail;
        const { color, style } = annotation;
        const drawFunc = (style && (Overlayer as any)[style]) || Overlayer.highlight;
        const hexColor = getAnnotationColor(color).hex;
        draw(drawFunc, { color: hexColor });
      });

      view.addEventListener('show-annotation', (e: any) => {
        const cfi = e.detail.value;
        const ann = annotationsRef.current.find((a) => a.value === cfi);
        if (ann) {
          const contents = view.renderer?.getContents() || [];
          const contentItem = contents.find((c: any) => c.index === e.detail.index);
          const targetDoc = contentItem?.doc;
          const offset = getViewportOffset(targetDoc);
          const rangeRect = e.detail.range?.getBoundingClientRect() || {
            left: 100,
            top: 100,
            width: 100,
            height: 20,
          };

          setSelection({
            text: ann.text,
            cfi: ann.value,
            sectionIndex: e.detail.index ?? 0,
            rect: {
              x: offset.left + rangeRect.left,
              y: offset.top + rangeRect.top,
              width: rangeRect.width,
              height: rangeRect.height,
            },
            existingAnnotation: ann,
          });
        }
      });

      try {
        await view.open(bookSource);
        if (isCancelled) return;

        const { book } = view;

        // Extract metadata
        const title = formatLanguageMap(book.metadata?.title) || 'Untitled Book';
        const author = formatContributor(book.metadata?.author || book.metadata?.creator);
        const publisher = formatContributor(book.metadata?.publisher);
        const language = formatLanguageMap(book.metadata?.language);
        const description = formatLanguageMap(book.metadata?.description);
        const identifier = formatLanguageMap(book.metadata?.identifier);
        const published = formatLanguageMap(book.metadata?.published || book.metadata?.date);
        const subject = book.metadata?.subject;

        let coverUrl: string | undefined;
        let coverBlob: Blob | null = null;
        try {
          coverBlob = await Promise.resolve(book.getCover?.());
          if (coverBlob) {
            coverUrl = URL.createObjectURL(coverBlob);
          }
        } catch (e) {
          console.warn('Cover extraction failed:', e);
        }

        // Persist extracted metadata & cover thumbnail to recent books and local cache
        if (coverBlob) {
          storeBookCover(bookId, coverBlob).catch(console.error);
          blobToThumbnailDataUrl(coverBlob)
            .then((thumbUrl) => {
              saveLocalBookCache(bookId, {
                title: title !== 'Untitled Book' ? title : undefined,
                author: author !== 'Unknown Author' ? author : undefined,
                coverUrl: thumbUrl,
                extracted: true,
              });
              updateRecentBookMetadata(bookId, {
                title: title !== 'Untitled Book' ? title : undefined,
                author: author !== 'Unknown Author' ? author : undefined,
                coverUrl: thumbUrl,
              });
            })
            .catch(() => {
              saveLocalBookCache(bookId, {
                title: title !== 'Untitled Book' ? title : undefined,
                author: author !== 'Unknown Author' ? author : undefined,
                extracted: true,
              });
              updateRecentBookMetadata(bookId, {
                title: title !== 'Untitled Book' ? title : undefined,
                author: author !== 'Unknown Author' ? author : undefined,
              });
            });
        } else {
          saveLocalBookCache(bookId, {
            title: title !== 'Untitled Book' ? title : undefined,
            author: author !== 'Unknown Author' ? author : undefined,
            extracted: true,
          });
          updateRecentBookMetadata(bookId, {
            title: title !== 'Untitled Book' ? title : undefined,
            author: author !== 'Unknown Author' ? author : undefined,
          });
        }

        const metaObj: BookMetadata = {
          title,
          author,
          publisher,
          language,
          description,
          identifier,
          published,
          subject,
          coverUrl,
        };
        setMetadata(metaObj);
        document.title = `${title} — Folio`;

        // Extract TOC
        if (book.toc) {
          setTOC(book.toc);
        }

        // Apply visual styles
        applyStyles();

        // Load annotations & bookmarks from SQLite
        const [loadedAnns, loadedBms] = await Promise.all([
          loadDbAnnotations(bookId),
          loadDbBookmarks(bookId),
        ]);
        updateAnnotations(loadedAnns);
        updateBookmarks(loadedBms);

        // Restore saved location or text start
        const savedLoc = await loadDbLastLocation(bookId);

        if (savedLoc?.cfi) {
          await view.goTo(savedLoc.cfi);
        } else if (savedLoc?.fraction != null && savedLoc.fraction > 0) {
          await view.goToFraction(savedLoc.fraction);
        } else {
          await view.init({ showTextStart: true });
        }

        setTimeout(() => {
          isInitialLoadRef.current = false;
        }, 800);

        if (viewRef.current) {
          for (const ann of loadedAnns) {
            viewRef.current.addAnnotation(ann);
          }
        }

        // Always automatically pull latest progress from server on open
        pullBookProgress(bookId)
          .then(async (remoteProgress) => {
            if (remoteProgress?.success && remoteProgress.location) {
              const remoteLoc = remoteProgress.location;
              const remotePct = Math.round(remoteProgress.progressPercent || 0);
              const localPct = Math.round((savedLoc?.fraction || 0) * 100);

              if (remoteLoc !== savedLoc?.cfi && (remotePct >= localPct || !savedLoc?.cfi)) {
                if (viewRef.current) {
                  await viewRef.current.goTo(remoteLoc);
                  showSyncToast(t('reader.syncSuccess', { percent: remotePct }), 'success');
                }
              }
            }
          })
          .catch((err) => {
            console.warn('Auto progress fetch on book open failed:', err);
          });

        // Trigger background sync for bookmarks and annotations
        syncBookData(bookId)
          .then(async (res) => {
            if (
              res &&
              (res.bookmarksSynced > 0 || res.annotationsSynced > 0 || res.progressSynced)
            ) {
              const [syncedAnns, syncedBms] = await Promise.all([
                loadDbAnnotations(bookId),
                loadDbBookmarks(bookId),
              ]);
              updateAnnotations(syncedAnns);
              updateBookmarks(syncedBms);
              if (viewRef.current) {
                for (const ann of syncedAnns) {
                  viewRef.current.addAnnotation(ann);
                }
              }
            }
          })
          .catch(console.warn);

        setSectionFractions(view.getSectionFractions() || []);
      } catch (err) {
        console.error('Failed to open book with foliate-js:', err);
      }
    }

    initBook();

    return () => {
      isCancelled = true;
      paginatorRef.current?.destroy();
      paginatorRef.current = null;
      if (viewRef.current) {
        try {
          viewRef.current.close?.();
        } catch (e) {
          console.warn('Error closing foliate view:', e);
        }
      }
      syncBookData(bookId).catch(console.warn);
    };
  }, [bookId, bookSource]);

  // Window resize handler for column adjustments
  useEffect(() => {
    const handleResize = () => {
      applyStyles();
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [applyStyles]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Don't capture when typing in inputs/textareas
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        viewRef.current?.goLeft();
        if (showControls) scheduleAutoHide();
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        viewRef.current?.goRight();
        if (showControls) scheduleAutoHide();
      } else if (e.key === 'Escape') {
        if (selection) {
          setSelection(null);
          clearAllSelections();
          return;
        }
        if (isSettingsOpen) {
          setIsSettingsOpen(false);
          return;
        }
        if (isBookInfoOpen) {
          setIsBookInfoOpen(false);
          return;
        }
        if (footnote) {
          setFootnote(null);
          return;
        }
        if ((isMobile || !settings.sidebarPinned) && settings.sidebarOpen) {
          onUpdateSettings({ sidebarOpen: false });
          return;
        }
        setShowControls((prev) => {
          const next = !prev;
          if (next) scheduleAutoHide();
          else cancelAutoHide();
          return next;
        });
      } else if (e.key === 'm' || e.key === 'M') {
        setShowControls((prev) => {
          const next = !prev;
          if (next) scheduleAutoHide();
          else cancelAutoHide();
          return next;
        });
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [selection, isSettingsOpen, isBookInfoOpen, footnote, settings, onUpdateSettings, showControls, scheduleAutoHide, cancelAutoHide, clearAllSelections, isMobile]);

  // TOC Navigation
  const handleSelectTOC = (href: string) => {
    if (selectionRef.current) {
      setSelection(null);
      clearAllSelections();
    }
    viewRef.current?.goTo(href);
    if (isMobile || !settings.sidebarPinned) {
      onUpdateSettings({ sidebarOpen: false });
    }
  };

  // Annotations management
  const handleSaveAnnotation = async (data: {
    value: string;
    text: string;
    color: string;
    style?: 'highlight' | 'underline' | 'squiggly' | 'strikethrough';
    note?: string;
    sectionIndex: number;
  }) => {
    const colorKey = getAnnotationColorKey(data.color);
    const newAnn: Annotation = {
      id: `ann-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      bookId,
      value: data.value,
      color: colorKey,
      style: 'highlight',
      text: data.text,
      note: data.note,
      createdAt: new Date().toISOString(),
      chapterTitle,
      sectionIndex: data.sectionIndex,
    };

    await saveDbAnnotation(newAnn);
    const updated = await loadDbAnnotations(bookId);
    updateAnnotations(updated);
    viewRef.current?.addAnnotation(newAnn);
    clearAllSelections();
    setSelection(null);
    syncBookData(bookId).catch(console.warn);
  };

  const handleDeleteAnnotation = async (value: string) => {
    await deleteDbAnnotation(bookId, value);
    const updated = await loadDbAnnotations(bookId);
    updateAnnotations(updated);
    viewRef.current?.deleteAnnotation({ value });
    clearAllSelections();
    setSelection(null);
    syncBookData(bookId).catch(console.warn);
  };

  const handleSelectAnnotation = (ann: Annotation) => {
    viewRef.current?.showAnnotation(ann);
    if (isMobile || !settings.sidebarPinned) {
      onUpdateSettings({ sidebarOpen: false });
    }
  };

  // Bookmarks management
  const handleAddCurrentBookmark = async () => {
    if (!currentCFI) return;
    const newBm: Bookmark = {
      id: `bm-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      bookId,
      cfi: currentCFI,
      fraction: progressFraction,
      locationLabel,
      chapterTitle,
      createdAt: new Date().toISOString(),
    };
    await saveDbBookmark(newBm);
    const updated = await loadDbBookmarks(bookId);
    updateBookmarks(updated);
    syncBookData(bookId).catch(console.warn);
  };

  const handleDeleteBookmark = async (id: string) => {
    await deleteDbBookmark(bookId, id);
    const updated = await loadDbBookmarks(bookId);
    updateBookmarks(updated);
    syncBookData(bookId).catch(console.warn);
  };

  const handleSelectBookmark = (bm: Bookmark) => {
    if (selectionRef.current) {
      setSelection(null);
      clearAllSelections();
    }
    viewRef.current?.goTo(bm.cfi);
    if (isMobile || !settings.sidebarPinned) {
      onUpdateSettings({ sidebarOpen: false });
    }
  };

  return (
    <div
      className={`foliate-reader-root theme-${settings.theme} ${
        showControls ? 'controls-visible' : 'controls-hidden'
      }`}
    >
      {/* Top Header Bar matching Screenshots 1 & 3 */}
      <HeaderBar
        onBackToLibrary={onBackToLibrary}
        onToggleSidebar={() =>
          onUpdateSettings({
            sidebarOpen: !settings.sidebarOpen,
          })
        }
        isSidebarOpen={settings.sidebarOpen}
        onToggleSettings={() => {
          setIsSettingsOpen((prev) => !prev);
          if (showControls) cancelAutoHide();
        }}
        isSettingsOpen={isSettingsOpen}
        settingsBtnRef={settingsBtnRef}
        chapterTitle={chapterTitle}
        onMouseEnter={() => {
          isHoveringControlsRef.current = true;
          cancelAutoHide();
        }}
        onMouseLeave={() => {
          isHoveringControlsRef.current = false;
          if (showControls) scheduleAutoHide();
        }}
      />

      {/* Main Workspace: Sidebar + Reader */}
      <div className="reader-workspace">
        {/* Floating backdrop for unpinned sidebar (always on mobile or when unpinned on desktop) */}
        {(isMobile || !settings.sidebarPinned) && settings.sidebarOpen && (
          <div
            className="sidebar-floating-backdrop"
            onClick={() => onUpdateSettings({ sidebarOpen: false })}
            title="Click to close sidebar"
          />
        )}

        {/* Foliate Sidebar */}
        <Sidebar
          isOpen={settings.sidebarOpen}
          isPinned={isPinned}
          onTogglePin={
            isMobile
              ? undefined
              : () =>
                  onUpdateSettings({
                    sidebarPinned: !settings.sidebarPinned,
                    sidebarOpen: true,
                  })
          }
          activeTab={settings.activeTab}
          onTabChange={(tab) => onUpdateSettings({ activeTab: tab })}
          metadata={metadata}
          toc={toc}
          currentHref={currentHref}
          onSelectTOC={handleSelectTOC}
          annotations={annotations}
          onSelectAnnotation={handleSelectAnnotation}
          onDeleteAnnotation={handleDeleteAnnotation}
          bookmarks={bookmarks}
          onSelectBookmark={handleSelectBookmark}
          onDeleteBookmark={handleDeleteBookmark}
          onAddCurrentBookmark={handleAddCurrentBookmark}
          onOpenBookInfo={() => setIsBookInfoOpen(true)}
          onSyncProgress={handleSyncProgress}
          isSyncing={isSyncing}
        />

        {/* Reader Canvas Area */}
        <main
          className="reader-canvas-area"
          onClick={(e) => {
            dismissOriginalContextMenu();
            if (isSettingsOpen) {
              setIsSettingsOpen(false);
              return;
            }
            if ((isMobile || !settings.sidebarPinned) && settings.sidebarOpen) {
              onUpdateSettings({ sidebarOpen: false });
              return;
            }
            // If tapped directly on outer canvas / margin area on mobile
            const targetEl = e.target as HTMLElement;
            const isCanvasOrHost =
              e.target === e.currentTarget ||
              targetEl.classList?.contains('foliate-viewport-wrap') ||
              targetEl.tagName?.toLowerCase() === 'foliate-view' ||
              targetEl.closest?.('foliate-view') !== null;

            if (isCanvasOrHost) {
              const isMobile = isMobileDevice();
              const method = settings.pageTurnMethod || 'both';
              const allowTapTurn = isMobile && (method === 'tap' || method === 'both');
              if (allowTapTurn) {
                if (showControls) {
                  setShowControls(false);
                  cancelAutoHide();
                } else {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const tapScreenY = e.clientY - rect.top;
                  const xRatio = (e.clientX - rect.left) / rect.width;
                  const yRatio = (e.clientY - rect.top) / rect.height;

                  const sat = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sat') || '0', 10) || 0;
                  const sab = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sab') || '0', 10) || 0;
                  const topDeadzone = Math.max(84, 62 + sat);
                  const bottomDeadzone = Math.max(84, 62 + sab);

                  const isCenterTap = xRatio >= 0.35 && xRatio <= 0.65 && yRatio >= 0.35 && yRatio <= 0.65;
                  const isTopBarTap = tapScreenY <= topDeadzone;
                  const isBottomBarTap = tapScreenY >= (rect.height - bottomDeadzone);

                  if (isCenterTap || isTopBarTap || isBottomBarTap) {
                    setShowControls(true);
                    scheduleAutoHide();
                  } else if (xRatio <= 0.30) {
                    viewRef.current?.goLeft();
                  } else {
                    viewRef.current?.goRight();
                  }
                }
              }
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            dismissOriginalContextMenu();
            if (isSettingsOpen) {
              setIsSettingsOpen(false);
            }
            if (selectionRef.current) {
              setSelection(null);
              clearAllSelections();
            }
          }}
          onPointerDown={() => {
            dismissOriginalContextMenu();
            if (isSettingsOpen) {
              setIsSettingsOpen(false);
            }
            if (selectionRef.current) {
              setSelection(null);
              clearAllSelections();
            }
          }}
        >
          {/* Foliate-view container */}
          <div className="foliate-viewport-wrap" ref={viewerContainerRef} />

          {/* Bottom Progress Scrubber */}
          <ProgressScrubber
            fraction={progressFraction}
            pageInfo={pageInfo}
            locationLabel={locationLabel}
            averageSecondsPerPage={readingStats?.averageSecondsPerPage}
            displayMode={settings.footerDisplayMode || 'pages'}
            onDisplayModeChange={(mode) => onUpdateSettings({ footerDisplayMode: mode })}
            onSeek={(frac) => {
              if (selectionRef.current) {
                setSelection(null);
                clearAllSelections();
              }
              viewRef.current?.goToFraction(frac);
            }}
            onPrev={() => viewRef.current?.goLeft()}
            onNext={() => viewRef.current?.goRight()}
            sectionFractions={sectionFractions}
            onMouseEnter={() => {
              isHoveringControlsRef.current = true;
              cancelAutoHide();
            }}
            onMouseLeave={() => {
              isHoveringControlsRef.current = false;
              if (showControls) scheduleAutoHide();
            }}
          />
        </main>
      </div>

      {/* Settings Popover / Bottom Sheet */}
      <SettingsPopover
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        onUpdateSettings={onUpdateSettings}
        triggerRef={settingsBtnRef}
      />

      {/* Selection / Annotation Popover */}
      <AnnotationPopover
        selection={selection}
        onClose={() => {
          setSelection(null);
          clearAllSelections();
        }}
        onShowOriginalMenu={() => {
          setSelection(null);
        }}
        onSave={handleSaveAnnotation}
        onDelete={handleDeleteAnnotation}
      />

      {/* Footnote / Endnote Modal */}
      <FootnoteModal
        footnote={footnote}
        onClose={() => setFootnote(null)}
        onNavigate={(href) => viewRef.current?.goTo(href)}
      />

      {/* Book Metadata Info Modal */}
      <BookInfoModal
        isOpen={isBookInfoOpen}
        onClose={() => setIsBookInfoOpen(false)}
        metadata={metadata}
        progressPercent={progressFraction * 100}
        currentChapter={chapterTitle}
        pageInfo={pageInfo}
        readingStats={readingStats}
        onSyncProgress={handleSyncProgress}
        isSyncing={isSyncing}
        syncMessage={syncMessage}
      />

      {/* Sync Toast Notification */}
      {syncToast && (
        <div className={`reader-toast-notification toast-${syncToast.type || 'info'}`}>
          <RefreshCw size={15} className={isSyncing ? 'animate-spin' : ''} />
          <span>{syncToast.message}</span>
        </div>
      )}
    </div>
  );
};
