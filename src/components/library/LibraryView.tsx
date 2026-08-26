import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BookOpen,
  Folder,
  Globe,
  Settings as SettingsIcon,
  Trash2,
  Clock,
  Sparkles,
  UserCircle,
  RefreshCw,
  Search,
  FolderOpen,
  ShieldAlert,
  LayoutGrid,
  List as ListIcon,
  ChevronRight,
  ArrowLeft,
  X,
  WifiOff,
  MoreVertical,
} from 'lucide-react';
import { fileManager } from '../../services/fileManager';
import { isMobileDevice } from '../../services/systemUi';
import { useAuth } from '../../context/AuthContext';
import {
  loadLocalBooksCache,
  saveLocalBookCache,
  storeBookCover,
  blobToThumbnailDataUrl,
  formatLanguageMap,
  formatContributor,
  loadLastLocation,
  loadRecentBooks,
} from '../../services/storage';
import { LocalBookFile } from '../../types/browse';
import { ReaderSettings, RecentBook } from '../../types/reader';
import { FolderStackCover } from './FolderStackCover';
import { BookContextMenu } from './BookContextMenu';
import { ResetProgressModal } from './ResetProgressModal';
import {
  pullBookProgress,
  loadDbLastLocation,
  resetBookProgress,
  setBookReadStatus,
} from '../../services/readerDb';
import { useBackHandler } from '../../services/backHandler';
import { useTranslation, formatPluralRussian } from '../../i18n';

interface LibraryViewProps {
  settings: ReaderSettings;
  onOpenLocalBook: (file: LocalBookFile, meta?: { title?: string; author?: string; coverUrl?: string }) => void;
  onOpenBrowse: () => void;
  onOpenSettings: () => void;
  onOpenProfile: () => void;
  onUpdateSettings?: (settings: Partial<ReaderSettings>) => void;
}

export const LibraryView: React.FC<LibraryViewProps> = ({
  settings,
  onOpenLocalBook,
  onOpenBrowse,
  onOpenSettings,
  onOpenProfile,
  onUpdateSettings,
}) => {
  const { t, resolvedLanguage } = useTranslation();
  const { isOffline, checkOnlineStatus } = useAuth();
  const [localBooks, setLocalBooks] = useState<LocalBookFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentFolderPath, setCurrentFolderPath] = useState<string[]>([]);
  const [hasPermission, setHasPermission] = useState(true);
  const [recentBooks, setRecentBooks] = useState<RecentBook[]>(() => loadRecentBooks().slice(0, 3));
  const [dbProgressMap, setDbProgressMap] = useState<Record<string, { fraction: number; isRead?: boolean }>>({});
  const isMobile = isMobileDevice();

  const getBookPluralLabel = useCallback((count: number) => {
    if (resolvedLanguage === 'ru') {
      return formatPluralRussian(count, t('library.book_one'), 'книги', t('library.book_other'));
    }
    return count === 1 ? t('library.book_one') : t('library.book_other');
  }, [resolvedLanguage, t]);

  // Context menu state
  const [menuState, setMenuState] = useState<{
    isOpen: boolean;
    book: LocalBookFile | null;
    position: { x: number; y: number };
    isRead?: boolean;
  }>({
    isOpen: false,
    book: null,
    position: { x: 0, y: 0 },
    isRead: false,
  });

  // Reset Progress confirmation modal state
  const [resetModalState, setResetModalState] = useState<{
    isOpen: boolean;
    book: LocalBookFile | null;
    title: string;
    percent?: number;
  }>({
    isOpen: false,
    book: null,
    title: '',
  });

  // Back button handling in LibraryView (highest to lowest priority)
  useBackHandler(() => { setCurrentFolderPath((prev) => prev.slice(0, -1)); return true; }, currentFolderPath.length > 0, 40);
  useBackHandler(() => { setSearchQuery(''); return true; }, Boolean(searchQuery), 30);

  const loadAllProgress = useCallback(async (books: LocalBookFile[]) => {
    if (!books.length) return;
    try {
      const entries = await Promise.all(
        books.map(async (book) => {
          const loc = await loadDbLastLocation(book.id);
          return [book.id, loc ? { fraction: loc.fraction || 0, isRead: loc.isRead } : null] as const;
        })
      );
      setDbProgressMap((prev) => {
        const next = { ...prev };
        for (const [id, data] of entries) {
          if (data) {
            next[id] = data;
          }
        }
        return next;
      });
    } catch (err) {
      console.warn('Failed to load progress from SQLite:', err);
    }
  }, []);

  const refreshRecentProgress = useCallback(() => {
    const list = loadRecentBooks().slice(0, 3);
    setRecentBooks(list);

    // Concurrently fetch latest server progress for all up to 3 recent books
    list.forEach((book) => {
      if (book.id) {
        pullBookProgress(book.id)
          .then((res) => {
            if (res?.success && res.location) {
              const frac = (res.progressPercent || 0) / 100;
              setRecentBooks((prev) =>
                prev.map((b) =>
                  b.id === book.id && Math.abs((b.progressFraction || 0) - frac) > 0.005
                    ? { ...b, progressFraction: frac }
                    : b
                )
              );
              setDbProgressMap((prev) => ({
                ...prev,
                [book.id]: { fraction: frac, isRead: res.isRead },
              }));
            }
          })
          .catch(console.warn);
      }
    });
  }, []);

  useEffect(() => {
    refreshRecentProgress();
    loadAllProgress(localBooks);
  }, [localBooks, refreshRecentProgress, loadAllProgress]);

  // Re-fetch recent books progress when device reconnects
  useEffect(() => {
    const handleOnline = () => {
      refreshRecentProgress();
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('folio:connection-restored', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('folio:connection-restored', handleOnline);
    };
  }, [refreshRecentProgress]);

  // View mode: 'grid' | 'list'
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    return settings.libraryViewMode || (localStorage.getItem('folio_library_view_mode') as 'grid' | 'list') || 'grid';
  });

  useEffect(() => {
    if (settings.libraryViewMode && settings.libraryViewMode !== viewMode) {
      setViewMode(settings.libraryViewMode);
    }
  }, [settings.libraryViewMode]);

  const handleToggleViewMode = (mode: 'grid' | 'list') => {
    setViewMode(mode);
    localStorage.setItem('folio_library_view_mode', mode);
    onUpdateSettings?.({ libraryViewMode: mode });
  };

  useEffect(() => {
    fileManager.hasStoragePermission().then(setHasPermission);
  }, []);

  const handleRequestPermission = async () => {
    await fileManager.requestStoragePermission();
    setTimeout(async () => {
      const granted = await fileManager.hasStoragePermission();
      setHasPermission(granted);
      if (granted) {
        scanFolder();
      }
    }, 1000);
  };

  // Metadata & cover cache state: bookId -> { title, author, coverUrl }
  const [metaCache, setMetaCache] = useState<Record<string, { title: string; author: string; coverUrl?: string }>>(() =>
    loadLocalBooksCache()
  );

  // Scan local books directory
  const scanFolder = useCallback(async () => {
    if (!settings.downloadPath) {
      setLocalBooks([]);
      return;
    }
    setIsLoading(true);
    try {
      const files = await fileManager.scanLocalBooks(settings.downloadPath);
      setLocalBooks(files);
      setMetaCache(loadLocalBooksCache());
    } catch (err) {
      console.error('Failed to scan local books:', err);
    } finally {
      setIsLoading(false);
    }
  }, [settings.downloadPath]);

  const handleRefresh = useCallback(async () => {
    await Promise.all([
      scanFolder(),
      checkOnlineStatus().catch(() => false),
    ]);
    refreshRecentProgress();
  }, [scanFolder, checkOnlineStatus, refreshRecentProgress]);

  useEffect(() => {
    scanFolder();
  }, [scanFolder]);

  // Enrich local books metadata asynchronously
  useEffect(() => {
    let isCancelled = false;

    async function enrichLocalBooks() {
      const currentCache = loadLocalBooksCache();
      const needsEnrich = localBooks.filter((b) => {
        const cached = currentCache[b.id];
        return !cached || !cached.extracted || (cached.author === 'Unknown Author' && !cached.coverUrl);
      });

      if (needsEnrich.length === 0) return;

      for (const book of needsEnrich) {
        if (isCancelled) break;
        try {
          // Read book file bytes
          const file = await fileManager.readBookFile(book.filePath);
          if (!file) continue;

          let title = book.fileName.replace(/\.[^/.]+$/, '');
          let author = 'Unknown Author';
          let coverUrl: string | undefined = currentCache[book.id]?.coverUrl;
          let extracted = false;

          try {
            const { makeBook } = await import('../../foliate-js/view.js');
            const parsedBook: any = await makeBook(file);
            if (parsedBook) {
              if (parsedBook.metadata?.title) {
                title = formatLanguageMap(parsedBook.metadata.title) || title;
              }
              if (parsedBook.metadata?.author || parsedBook.metadata?.creator) {
                author = formatContributor(parsedBook.metadata.author || parsedBook.metadata.creator) || author;
              }
              if (parsedBook.getCover) {
                const coverBlob = await Promise.resolve(parsedBook.getCover());
                if (coverBlob) {
                  await storeBookCover(book.id, coverBlob);
                  coverUrl = await blobToThumbnailDataUrl(coverBlob);
                }
              }
              parsedBook.destroy?.();
              extracted = true;
            }
          } catch (e) {
            console.warn('Metadata extraction failed for:', book.fileName, e);
          }

          const metaItem = { title, author, coverUrl, extracted };
          saveLocalBookCache(book.id, metaItem);

          if (!isCancelled) {
            setMetaCache((prev) => ({ ...prev, [book.id]: metaItem }));
          }
        } catch (err) {
          console.warn('Error enriching book:', book.fileName, err);
        }
      }
    }

    enrichLocalBooks();

    return () => {
      isCancelled = true;
    };
  }, [localBooks]);

  // Context menu actions
  const handleOpenBookMenu = (
    book: LocalBookFile,
    e: React.MouseEvent,
    isRead: boolean
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuState({
      isOpen: true,
      book,
      position: { x: e.clientX, y: e.clientY },
      isRead,
    });
  };

  const handleCloseBookMenu = () => {
    setMenuState((prev) => ({ ...prev, isOpen: false, book: null }));
  };

  // Toggle Read / Unread status
  const handleToggleReadStatus = async (book: LocalBookFile, currentIsRead: boolean) => {
    const nextIsRead = !currentIsRead;
    const nextFraction = nextIsRead ? 1.0 : 0.0;

    // 1. Update React state immediately
    setDbProgressMap((prev) => ({
      ...prev,
      [book.id]: { fraction: nextFraction, isRead: nextIsRead },
    }));

    setRecentBooks((prev) =>
      prev.map((b) =>
        b.id === book.id || (book.filePath && b.filePath === book.filePath)
          ? { ...b, progressFraction: nextFraction }
          : b
      )
    );

    // 2. Persist to DB / Server
    await setBookReadStatus(book.id, nextIsRead);
  };

  // Open Reset Progress Modal
  const handleOpenResetModalForBook = (book: LocalBookFile, percent: number) => {
    const meta = metaCache[book.id];
    const title = meta?.title || book.fileName.replace(/\.[^/.]+$/, '');
    setResetModalState({
      isOpen: true,
      book,
      title,
      percent,
    });
  };

  // Confirm Reset Progress
  const handleConfirmResetProgress = async (resetOnServer: boolean) => {
    if (!resetModalState.book) return;
    const book = resetModalState.book;

    // 1. Update React state immediately
    setDbProgressMap((prev) => {
      const next = { ...prev };
      delete next[book.id];
      return next;
    });

    setRecentBooks((prev) =>
      prev.map((b) =>
        b.id === book.id || (book.filePath && b.filePath === book.filePath)
          ? { ...b, progressFraction: 0, lastLocation: undefined }
          : b
      )
    );

    // 2. Perform DB / Server reset
    await resetBookProgress(book.id, resetOnServer);
    refreshRecentProgress();
  };

  // Delete local book
  const handleDeleteBook = async (book: LocalBookFile, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const name = metaCache[book.id]?.title || book.fileName;
    if (confirm(t('library.deleteBookConfirm', { name }))) {
      await fileManager.deleteBookFile(book.filePath);
      await scanFolder();
      refreshRecentProgress();
    }
  };

  // Helper to extract folder segments from relativePath / folderName
  const getBookFolderSegments = useCallback((book: LocalBookFile): string[] => {
    if (book.relativePath) {
      const parts = book.relativePath.split('/');
      return parts.slice(0, parts.length - 1).filter(Boolean);
    }
    if (book.folderName) {
      return book.folderName.split('/').filter(Boolean);
    }
    return [];
  }, []);

  // Delete entire folder (including nested subfolders)
  const handleDeleteFolder = async (folderName: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const targetPrefix = [...currentFolderPath, folderName];
    const booksInFolder = localBooks.filter((b) => {
      const segs = getBookFolderSegments(b);
      return targetPrefix.every((p, idx) => segs[idx] === p);
    });

    if (confirm(t('library.deleteFolderConfirm', { name: folderName, count: booksInFolder.length }))) {
      for (const book of booksInFolder) {
        await fileManager.deleteBookFile(book.filePath);
      }
      await scanFolder();
    }
  };

  // Quick Resume a Recent Book
  const handleResumeBook = useCallback((book: RecentBook) => {
    if (!book) return;
    const match = localBooks.find(
      (b) => b.id === book.id || (book.filePath && b.filePath === book.filePath)
    );
    if (match) {
      onOpenLocalBook(match, metaCache[match.id] || {
        title: book.title,
        author: book.author,
        coverUrl: book.coverUrl,
      });
      return;
    }

    if (book.filePath) {
      const bookFile: LocalBookFile = {
        id: book.id,
        filePath: book.filePath,
        fileName: book.fileName || book.filePath.split(/[\\/]/).pop() || 'book.epub',
        relativePath: '',
        fileSize: book.fileSize || 0,
      };
      onOpenLocalBook(bookFile, {
        title: book.title,
        author: book.author,
        coverUrl: book.coverUrl,
      });
    }
  }, [localBooks, metaCache, onOpenLocalBook]);

  // Group books & subfolders by current navigation level
  const { currentLevelBooks, directSubfolderNames, directSubfolderMap, allNestedCount } = useMemo(() => {
    const subMap = new Map<string, LocalBookFile[]>();
    const levelBooks: LocalBookFile[] = [];

    for (const book of localBooks) {
      const segments = getBookFolderSegments(book);
      const isUnderCurrent = currentFolderPath.every((p, idx) => segments[idx] === p);
      if (!isUnderCurrent) continue;

      const remainder = segments.slice(currentFolderPath.length);
      if (remainder.length === 0) {
        levelBooks.push(book);
      } else {
        const directSub = remainder[0];
        const existing = subMap.get(directSub) || [];
        existing.push(book);
        subMap.set(directSub, existing);
      }
    }

    const subNames = Array.from(subMap.keys()).sort((a, b) => a.localeCompare(b));
    const totalCount =
      levelBooks.length + Array.from(subMap.values()).reduce((acc, list) => acc + list.length, 0);

    return {
      currentLevelBooks: levelBooks,
      directSubfolderNames: subNames,
      directSubfolderMap: subMap,
      allNestedCount: totalCount,
    };
  }, [localBooks, currentFolderPath, getBookFolderSegments]);

  // Handle Search Filtering
  const isSearching = searchQuery.trim().length > 0;
  const filteredSearchBooks = useMemo(() => {
    if (!isSearching) return [];
    const q = searchQuery.toLowerCase().trim();
    return localBooks.filter((book) => {
      const meta = metaCache[book.id];
      const title = (meta?.title || book.fileName).toLowerCase();
      const author = (meta?.author || '').toLowerCase();
      const folder = (book.folderName || '').toLowerCase();
      return title.includes(q) || author.includes(q) || folder.includes(q);
    });
  }, [isSearching, searchQuery, localBooks, metaCache]);

  return (
    <div className="library-view-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      {/* Top Header */}
      <header className="library-header">
        <div className="library-brand">
          <div className="library-logo-icon">
            <BookOpen size={24} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h1 className="library-title">{t('library.title')}</h1>
              {isOffline && (
                <span className="library-offline-badge" title={t('browse.offlineDesc')}>
                  <WifiOff size={11} />
                  {t('common.offline')}
                </span>
              )}
            </div>
            <p className="library-subtitle">{t('library.subtitle')}</p>
          </div>
        </div>

        <div className="library-header-actions">
          {/* Quick Resume Last Read Book */}
          {recentBooks.length > 0 && (
            <button
              type="button"
              className="library-open-btn library-resume-header-btn"
              onClick={() => handleResumeBook(recentBooks[0])}
              title={`${t('library.continueReading')} "${recentBooks[0].title}" (${Math.round((recentBooks[0].progressFraction || 0) * 100)}%)`}
            >
              <BookOpen size={16} />
              <span className="library-open-btn-text">{t('library.continueReading')}</span>
            </button>
          )}

          {/* Browse Folio Online Library */}
          <button
            type="button"
            className="library-open-btn library-catalog-btn"
            onClick={onOpenBrowse}
            title={t('browse.title')}
          >
            <Globe size={17} />
            <span className="library-open-btn-text">{t('library.catalog')}</span>
          </button>

          {/* Refresh Folder & Connectivity */}
          <button
            type="button"
            className="header-icon-btn"
            onClick={handleRefresh}
            title={t('library.refreshSync')}
          >
            <RefreshCw size={17} className={isLoading ? 'animate-spin' : ''} />
          </button>

          {/* Settings */}
          <button
            type="button"
            className="header-icon-btn"
            onClick={onOpenSettings}
            title={t('library.settings')}
          >
            <SettingsIcon size={17} />
          </button>

          {/* Profile */}
          <button
            type="button"
            className="header-icon-btn"
            onClick={onOpenProfile}
            title={t('library.profile')}
          >
            <UserCircle size={20} />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="library-main-content" style={{ flex: '1 1 0%', minHeight: 0, overflowY: 'auto' }}>
        {/* Permission prompt banner for Android */}
        {isMobile && !hasPermission && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '12px 14px',
              backgroundColor: 'rgba(234, 179, 8, 0.12)',
              border: '1px solid rgba(234, 179, 8, 0.35)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-primary)',
              flexWrap: 'wrap',
              marginBottom: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 200 }}>
              <ShieldAlert size={20} style={{ color: '#eab308', flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                {t('common.storageRequiredDesc')}
              </span>
            </div>
            <button
              type="button"
              className="auth-btn-primary"
              style={{ padding: '6px 14px', fontSize: 12 }}
              onClick={handleRequestPermission}
            >
              {t('common.grantPermission')}
            </button>
          </div>
        )}

        {/* Toolbar: Search, View Mode Toggle & Folder Path */}
        {localBooks.length > 0 && (
          <div className="library-toolbar-container">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Search input */}
              <div style={{ flex: '1 1 200px', position: 'relative' }}>
                <Search
                  size={16}
                  style={{
                    position: 'absolute',
                    left: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--text-muted)',
                  }}
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('library.searchPlaceholder')}
                  className="auth-input"
                  style={{ paddingLeft: 36, paddingRight: searchQuery ? 32 : 12, height: 38, fontSize: 13 }}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    style={{
                      position: 'absolute',
                      right: 10,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--text-muted)',
                      padding: 2,
                    }}
                    title={t('library.clearSearch')}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* View mode toggle (Grid / List) */}
              <div className="view-mode-toggle-group">
                <button
                  type="button"
                  className={`view-mode-btn ${viewMode === 'grid' ? 'active' : ''}`}
                  onClick={() => handleToggleViewMode('grid')}
                  title={t('settings.viewGrid')}
                  aria-label={t('settings.viewGrid')}
                >
                  <LayoutGrid size={16} />
                </button>
                <button
                  type="button"
                  className={`view-mode-btn ${viewMode === 'list' ? 'active' : ''}`}
                  onClick={() => handleToggleViewMode('list')}
                  title={t('settings.viewList')}
                  aria-label={t('settings.viewList')}
                >
                  <ListIcon size={16} />
                </button>
              </div>
            </div>

            {/* Folder Breadcrumb & Navigation */}
            {currentFolderPath.length > 0 && !isSearching && (
              <div
                className="library-folder-breadcrumb"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  overflowX: 'auto',
                  whiteSpace: 'nowrap',
                  paddingBottom: 2,
                }}
              >
                <button
                  type="button"
                  className="breadcrumb-back-btn"
                  onClick={() => setCurrentFolderPath([])}
                >
                  <ArrowLeft size={15} />
                  <span>{t('library.allBooks')}</span>
                </button>
                {currentFolderPath.map((folder, idx) => {
                  const isLast = idx === currentFolderPath.length - 1;
                  return (
                    <React.Fragment key={`${folder}-${idx}`}>
                      <ChevronRight size={14} className="breadcrumb-separator" />
                      <button
                        type="button"
                        onClick={() => setCurrentFolderPath((prev) => prev.slice(0, idx + 1))}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          background: 'none',
                          border: 'none',
                          color: isLast ? 'var(--accent-color)' : 'var(--text-secondary)',
                          fontWeight: isLast ? 700 : 500,
                          fontSize: 13,
                          cursor: 'pointer',
                          padding: 0,
                          flexShrink: 0,
                        }}
                      >
                        <Folder size={14} style={{ color: isLast ? 'var(--accent-color)' : 'var(--text-muted)' }} />
                        <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={folder}>
                          {folder}
                        </span>
                        {isLast && (
                          <span className="breadcrumb-count" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            ({allNestedCount} {getBookPluralLabel(allNestedCount)})
                          </span>
                        )}
                      </button>
                    </React.Fragment>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Continue Reading Section (up to 3 books) */}
        {recentBooks.length > 0 && !isSearching && currentFolderPath.length === 0 && (
          <div className="continue-reading-container">
            <div className="continue-reading-section-header">
              <div className="continue-reading-tag">
                <Clock size={13} />
                <span>{t('library.continueReadingTag')}</span>
              </div>
              {recentBooks.length > 1 && (
                <span className="continue-reading-count-badge">
                  {t('library.continueReadingCount', { count: recentBooks.length })}
                </span>
              )}
            </div>

            <div className={`continue-reading-cards-wrap count-${recentBooks.length}`}>
              {recentBooks.map((book) => {
                const pct = Math.round((book.progressFraction || 0) * 100);
                const cover = book.coverUrl || metaCache[book.id]?.coverUrl;
                return (
                  <div
                    key={book.id}
                    className="continue-reading-card"
                    onClick={() => handleResumeBook(book)}
                    title={`${t('library.continueReading')} "${book.title}" (${pct}%)`}
                  >
                    <div className="continue-reading-cover-wrap">
                      {cover ? (
                        <img
                          src={cover}
                          alt={book.title}
                          className="continue-reading-cover"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className="continue-reading-placeholder">
                          <BookOpen size={24} />
                        </div>
                      )}
                      {pct > 0 && (
                        <span className="continue-reading-badge">{pct}%</span>
                      )}
                    </div>

                    <div className="continue-reading-info">
                      <h4 className="continue-reading-title" title={book.title}>
                        {book.title}
                      </h4>
                      <p className="continue-reading-author" title={book.author}>
                        {book.author}
                      </p>

                      <div className="continue-reading-progress-row">
                        <div className="continue-reading-progress-track">
                          <div
                            className="continue-reading-progress-bar"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="continue-reading-pct">{pct}%</span>
                      </div>
                    </div>

                    {recentBooks.length === 1 && (
                      <div className="continue-reading-action">
                        <button
                          type="button"
                          className="continue-reading-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleResumeBook(book);
                          }}
                          title={t('library.continueReading')}
                          aria-label={t('library.continueReading')}
                        >
                          <span>{t('library.resume')}</span>
                          <ChevronRight size={16} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Local Books Section */}
        <section className="library-recent-section">
          {/* Section title & count */}
          {!settings.downloadPath ? null : localBooks.length === 0 ? null : (
            <div className="recent-section-header">
              <h2 className="recent-section-title">
                {isSearching
                  ? t('library.searchHeading', { query: searchQuery })
                  : currentFolderPath.length > 0
                  ? currentFolderPath[currentFolderPath.length - 1]
                  : t('library.booksAndCollections')}
              </h2>
              <span className="recent-section-count">
                {isSearching
                  ? t('library.foundCount', { count: filteredSearchBooks.length })
                  : `${allNestedCount} ${getBookPluralLabel(allNestedCount)}${
                      directSubfolderNames.length > 0 ? ` ${t('library.inFolders', { count: directSubfolderNames.length })}` : ''
                    }`}
              </span>
            </div>
          )}

          {!settings.downloadPath ? (
            <div className="library-empty-box">
              <FolderOpen size={40} className="empty-box-icon" />
              <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
                {t('library.booksFolderNotConfigured')}
              </h3>
              <p style={{ maxWidth: 400 }}>
                {t('library.configureFolderPrompt')}
              </p>
              <button
                type="button"
                className="auth-btn-primary"
                onClick={onOpenSettings}
                style={{ marginTop: 8 }}
              >
                {t('library.configureFolder')}
              </button>
            </div>
          ) : localBooks.length === 0 ? (
            <div className="library-empty-box">
              <Sparkles size={40} className="empty-box-icon" />
              <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>
                {t('library.noBooksInFolder')}
              </h3>
              <p style={{ maxWidth: 420, width: '100%', wordBreak: 'break-all', overflowWrap: 'anywhere' }}>
                {t('library.folderLabel')} <code style={{ fontSize: 12, wordBreak: 'break-all', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>{settings.downloadPath}</code>
              </p>
              <div style={{ display: 'flex', gap: 10, marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button
                  type="button"
                  className="auth-btn-primary"
                  onClick={onOpenBrowse}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  <Globe size={16} />
                  <span>{t('library.catalog')}</span>
                </button>
                <button
                  type="button"
                  className="auth-btn-secondary"
                  onClick={scanFolder}
                >
                  {t('common.refresh')}
                </button>
              </div>
            </div>
          ) : isSearching ? (
            /* Search results view */
            filteredSearchBooks.length === 0 ? (
              <div className="library-empty-box">
                <p>{t('library.noSearchResults', { query: searchQuery })}</p>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="books-grid">
                {filteredSearchBooks.map((book) => renderBookCardGrid(book))}
              </div>
            ) : (
              <div className="books-list">
                {filteredSearchBooks.map((book) => renderBookItemRow(book))}
              </div>
            )
          ) : currentLevelBooks.length === 0 && directSubfolderNames.length === 0 ? (
            <div className="library-empty-box">
              <p>{t('library.noBooksInThisFolder')}</p>
            </div>
          ) : (
            /* Active level view: folders & direct books */
            viewMode === 'grid' ? (
              <div className="books-grid">
                {/* 1. Direct subfolders as grid cards */}
                {directSubfolderNames.map((folderName) => {
                  const booksInFolder = directSubfolderMap.get(folderName) || [];
                  const sampleAuthors = Array.from(
                    new Set(
                      booksInFolder
                        .map((b) => metaCache[b.id]?.author)
                        .filter((a) => a && a !== 'Unknown Author' && a !== t('common.unknownAuthor'))
                    )
                  ).slice(0, 2).join(', ');

                  return (
                    <div
                      key={`folder-${folderName}`}
                      className="folder-grid-card"
                      onClick={() => setCurrentFolderPath((prev) => [...prev, folderName])}
                      title={t('library.openFolderTitle', { name: folderName })}
                    >
                      {/* Stacked covers */}
                      <div className="folder-stack-container">
                        <FolderStackCover books={booksInFolder} metaCache={metaCache} />
                        <span className="folder-count-badge">
                          <Folder size={10} />
                          <span>{booksInFolder.length}</span>
                        </span>
                        <button
                          type="button"
                          className="folder-delete-btn"
                          onClick={(e) => handleDeleteFolder(folderName, e)}
                          title={t('library.deleteFolder')}
                          aria-label={t('library.deleteFolder')}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>

                      {/* Details at bottom */}
                      <div className="folder-grid-details">
                        <div>
                          <h4 className="book-card-title" title={folderName}>
                            {folderName}
                          </h4>
                          <p className="book-card-author" title={sampleAuthors || t('library.collectionFolderHint')}>
                            {sampleAuthors || t('library.collectionFolderHint')}
                          </p>
                        </div>

                        <div className="folder-grid-footer">
                          <span className="folder-footer-count">
                            {booksInFolder.length} {getBookPluralLabel(booksInFolder.length)}
                          </span>
                          <span className="folder-open-action">
                            <span>{t('common.open')}</span>
                            <ChevronRight size={13} />
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* 2. Direct books as grid cards */}
                {currentLevelBooks.map((book) => renderBookCardGrid(book))}
              </div>
            ) : (
              /* List view: folders & direct books */
              <div className="books-list">
                {/* 1. Direct subfolders as list items */}
                {directSubfolderNames.map((folderName) => {
                  const booksInFolder = directSubfolderMap.get(folderName) || [];
                  const sampleAuthors = Array.from(
                    new Set(
                      booksInFolder
                        .map((b) => metaCache[b.id]?.author)
                        .filter((a) => a && a !== 'Unknown Author' && a !== t('common.unknownAuthor'))
                    )
                  ).slice(0, 2).join(', ');

                  return (
                    <div
                      key={`folder-${folderName}`}
                      className="folder-list-item"
                      onClick={() => setCurrentFolderPath((prev) => [...prev, folderName])}
                    >
                      {/* Mini stacked cover thumbnail */}
                      <div className="folder-list-thumbnail-wrap">
                        <FolderStackCover books={booksInFolder} metaCache={metaCache} compact={true} />
                      </div>

                      {/* Folder info */}
                      <div className="book-list-details">
                        <div className="folder-list-title-row">
                          <h4 className="book-list-title folder-title">
                            {folderName}
                          </h4>
                          <span className="folder-list-badge">
                            {booksInFolder.length} {getBookPluralLabel(booksInFolder.length)}
                          </span>
                        </div>

                        {sampleAuthors && (
                          <p className="book-list-author" title={sampleAuthors}>
                            {sampleAuthors}
                          </p>
                        )}
                        <p className="folder-list-hint">
                          {t('library.collectionFolderHint')}
                        </p>
                      </div>

                      {/* Right side actions */}
                      <div className="folder-list-right">
                        <button
                          type="button"
                          className="list-delete-btn"
                          onClick={(e) => handleDeleteFolder(folderName, e)}
                          title={t('library.deleteFolder')}
                          aria-label={t('library.deleteFolder')}
                        >
                          <Trash2 size={15} />
                        </button>
                        <ChevronRight size={18} className="folder-list-arrow" />
                      </div>
                    </div>
                  );
                })}

                {/* 2. Direct books as list items */}
                {currentLevelBooks.map((book) => renderBookItemRow(book))}
              </div>
            )
          )}
        </section>
      </main>

      {/* Book Context Menu */}
      {menuState.isOpen && menuState.book && (
        <BookContextMenu
          isOpen={menuState.isOpen}
          position={menuState.position}
          isRead={menuState.isRead}
          onClose={handleCloseBookMenu}
          onMarkAsRead={() => {
            if (menuState.book) {
              handleToggleReadStatus(menuState.book, menuState.isRead || false);
            }
          }}
          onOpenResetModal={() => {
            if (menuState.book) {
              const dbLoc = dbProgressMap[menuState.book.id];
              const recentLoc = loadLastLocation(menuState.book.id);
              const fraction = dbLoc?.fraction ?? recentLoc?.fraction ?? 0;
              const percent = Math.round(fraction * 100);
              handleOpenResetModalForBook(menuState.book, percent);
            }
          }}
          onDeleteBook={() => {
            if (menuState.book) {
              handleDeleteBook(menuState.book);
            }
          }}
        />
      )}

      {/* Reset Progress Modal */}
      {resetModalState.isOpen && resetModalState.book && (
        <ResetProgressModal
          isOpen={resetModalState.isOpen}
          bookTitle={resetModalState.title}
          currentPercent={resetModalState.percent}
          isOffline={isOffline}
          onClose={() => setResetModalState((prev) => ({ ...prev, isOpen: false, book: null }))}
          onConfirmReset={handleConfirmResetProgress}
        />
      )}
    </div>
  );

  // Helper renderer: Book Card for Grid View
  function renderBookCardGrid(book: LocalBookFile) {
    const meta = metaCache[book.id];
    const title = meta?.title || book.fileName.replace(/\.[^/.]+$/, '');
    const author = meta?.author || t('common.unknownAuthor');
    const folderName = book.folderName;

    // Reading location & progress
    const dbLoc = dbProgressMap[book.id];
    const recentLoc = loadLastLocation(book.id);
    const fraction = dbLoc?.fraction ?? recentLoc?.fraction ?? 0;
    const percent = Math.round(fraction * 100);
    const isRead = dbLoc?.isRead ?? (percent >= 100);

    return (
      <div
        key={book.id}
        className="book-card"
        onClick={() => onOpenLocalBook(book, meta)}
        onContextMenu={(e) => handleOpenBookMenu(book, e, isRead)}
      >
        <div className="book-card-cover-wrap">
          {/* Background placeholder */}
          <div className="book-card-cover-placeholder">
            <BookOpen size={36} />
          </div>

          {/* Cover image */}
          {meta?.coverUrl && (
            <img
              src={meta.coverUrl}
              alt={title}
              className="book-card-cover"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          )}

          {/* Folder/Series badge if in search view */}
          {folderName && isSearching && (
            <span
              style={{
                position: 'absolute',
                top: 6,
                left: 6,
                backgroundColor: 'rgba(0, 0, 0, 0.75)',
                color: '#c084fc',
                fontSize: 10,
                fontWeight: 600,
                padding: '2px 6px',
                borderRadius: 6,
                zIndex: 5,
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                maxWidth: '85%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={folderName}
            >
              <Folder size={10} />
              <span>{folderName.replace(/\//g, ' / ')}</span>
            </span>
          )}

          {/* Percent badge overlay in grid (as in e-reader reference) */}
          {percent > 0 && (
            <span className="book-card-percent-badge">
              {percent}%
            </span>
          )}

          {/* Context Menu 3-Dots Button */}
          <button
            type="button"
            className="book-card-menu-btn"
            onClick={(e) => handleOpenBookMenu(book, e, isRead)}
            title={t('library.bookOptions')}
            aria-label={t('library.bookOptions')}
          >
            <MoreVertical size={16} />
          </button>
        </div>

        <div className="book-card-details">
          <h4 className="book-card-title" title={title}>
            {title}
          </h4>
          <p className="book-card-author" title={author}>
            {author}
          </p>

          <div className="book-card-progress-wrap">
            <div className="book-card-progress-bar">
              <div
                className="book-card-progress-fill"
                style={{ width: `${percent}%` }}
              />
            </div>
            <span className="book-card-percent">{percent}%</span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 4,
              fontSize: 11,
              color: 'var(--text-muted)',
            }}
          >
            <span>
              {book.fileSize
                ? `${(book.fileSize / (1024 * 1024)).toFixed(1)} MB`
                : ''}
            </span>

            {book.modifiedAt && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <Clock size={11} />
                <span>
                  {new Date(book.modifiedAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Helper renderer: Book Item Row for List View (matching screenshot 1)
  function renderBookItemRow(book: LocalBookFile) {
    const meta = metaCache[book.id];
    const title = meta?.title || book.fileName.replace(/\.[^/.]+$/, '');
    const author = meta?.author || t('common.unknownAuthor');
    const folderName = book.folderName;

    // Reading location & progress
    const dbLoc = dbProgressMap[book.id];
    const recentLoc = loadLastLocation(book.id);
    const fraction = dbLoc?.fraction ?? recentLoc?.fraction ?? 0;
    const percent = Math.round(fraction * 100);
    const isRead = dbLoc?.isRead ?? (percent >= 100);
    const readingStatus = isRead ? t('common.completed') : percent > 0 ? t('common.reading') : t('common.notStarted');

    return (
      <div
        key={book.id}
        className="book-list-item"
        onClick={() => onOpenLocalBook(book, meta)}
        onContextMenu={(e) => handleOpenBookMenu(book, e, isRead)}
      >
        {/* Cover thumbnail on the left */}
        <div className="book-list-thumbnail-wrap">
          {meta?.coverUrl ? (
            <img
              src={meta.coverUrl}
              alt={title}
              className="book-list-thumbnail"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="book-list-thumbnail-placeholder">
              <BookOpen size={20} />
            </div>
          )}
        </div>

        {/* Center book info: Title, Series/Folder subtitle, Author */}
        <div className="book-list-details">
          <h4 className="book-list-title" title={title}>
            {title}
          </h4>

          {folderName && (
            <p className="book-list-subtitle" title={folderName}>
              <Folder size={11} style={{ opacity: 0.7 }} />
              <span>{folderName.replace(/\//g, ' / ')}</span>
            </p>
          )}

          <p className="book-list-author" title={author}>
            {author}
          </p>
        </div>

        {/* Right side reading status & progress */}
        <div className="book-list-reading-info">
          <span className="book-list-status">{readingStatus}</span>
          <span className="book-list-percent">{percent}%</span>
        </div>

        {/* 3-Dots Menu button */}
        <div className="book-list-actions">
          <button
            type="button"
            className="list-menu-btn"
            onClick={(e) => handleOpenBookMenu(book, e, isRead)}
            title={t('library.bookOptions')}
            aria-label={t('library.bookOptions')}
          >
            <MoreVertical size={16} />
          </button>
        </div>
      </div>
    );
  }
};
