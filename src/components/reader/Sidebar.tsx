import React from 'react';
import { BookMetadata, TOCItem, Annotation, Bookmark } from '../../types/reader';
import { TOCView } from './TOCView';
import { AnnotationsView } from './AnnotationsView';
import { BookmarksView } from './BookmarksView';
import {
  List,
  Edit3,
  Bookmark as BookmarkIcon,
  Info,
  BookOpen,
  Pin,
  PinOff,
  RefreshCw,
} from 'lucide-react';
import { useTranslation } from '../../i18n';

interface SidebarProps {
  isOpen: boolean;
  isPinned: boolean;
  onTogglePin?: () => void;
  activeTab: 'contents' | 'annotations' | 'bookmarks';
  onTabChange: (tab: 'contents' | 'annotations' | 'bookmarks') => void;
  metadata: BookMetadata | null;
  toc: TOCItem[];
  currentHref: string | null;
  onSelectTOC: (href: string) => void;
  annotations: Annotation[];
  onSelectAnnotation: (annotation: Annotation) => void;
  onDeleteAnnotation: (value: string) => void;
  bookmarks: Bookmark[];
  onSelectBookmark: (bookmark: Bookmark) => void;
  onDeleteBookmark: (id: string) => void;
  onAddCurrentBookmark: () => void;
  onOpenBookInfo: () => void;
  onSyncProgress?: () => void;
  isSyncing?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({
  isOpen,
  isPinned,
  onTogglePin,
  activeTab,
  onTabChange,
  metadata,
  toc,
  currentHref,
  onSelectTOC,
  annotations,
  onSelectAnnotation,
  onDeleteAnnotation,
  bookmarks,
  onSelectBookmark,
  onDeleteBookmark,
  onAddCurrentBookmark,
  onOpenBookInfo,
  onSyncProgress,
  isSyncing = false,
}) => {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <aside className={`sidebar-container ${isPinned ? 'pinned' : 'floating'}`}>
      {/* Book Metadata Header */}
      <div className="sidebar-book-header">
        <div className="sidebar-book-cover-wrap">
          {metadata?.coverUrl ? (
            <img
              src={metadata.coverUrl}
              alt={metadata.title || t('common.untitledBook')}
              className="sidebar-book-cover"
            />
          ) : (
            <div className="sidebar-book-cover-placeholder">
              <BookOpen size={24} />
            </div>
          )}
        </div>

        <div className="sidebar-book-info">
          <h4 className="sidebar-book-title" title={metadata?.title}>
            {metadata?.title || t('common.untitledBook')}
          </h4>
          <p className="sidebar-book-author" title={metadata?.author}>
            {metadata?.author || t('common.unknownAuthor')}
          </p>
        </div>

        <div className="sidebar-header-actions">
          {onSyncProgress && (
            <button
              type="button"
              className="sidebar-info-btn sidebar-sync-btn"
              onClick={onSyncProgress}
              disabled={isSyncing}
              title={isSyncing ? t('reader.syncing') : t('reader.syncProgress')}
              aria-label={t('reader.syncProgress')}
            >
              <RefreshCw size={15} className={isSyncing ? 'animate-spin' : ''} />
            </button>
          )}

          <button
            type="button"
            className="sidebar-info-btn"
            onClick={onOpenBookInfo}
            title={t('reader.bookDetails')}
            aria-label={t('reader.bookDetails')}
          >
            <Info size={16} />
          </button>

          {onTogglePin && (
            <button
              type="button"
              className={`sidebar-info-btn sidebar-pin-btn ${isPinned ? 'active' : ''}`}
              onClick={onTogglePin}
              title={isPinned ? t('reader.unpinSidebar') : t('reader.pinSidebar')}
              aria-label={isPinned ? t('reader.unpinSidebar') : t('reader.pinSidebar')}
            >
              {isPinned ? <Pin size={16} /> : <PinOff size={16} />}
            </button>
          )}
        </div>
      </div>

      {/* Tab Content Body */}
      <div className="sidebar-content-body">
        {activeTab === 'contents' && (
          <TOCView
            toc={toc}
            currentHref={currentHref}
            onSelect={onSelectTOC}
          />
        )}

        {activeTab === 'annotations' && (
          <AnnotationsView
            annotations={annotations}
            onSelectAnnotation={onSelectAnnotation}
            onDeleteAnnotation={onDeleteAnnotation}
          />
        )}

        {activeTab === 'bookmarks' && (
          <BookmarksView
            bookmarks={bookmarks}
            onSelectBookmark={onSelectBookmark}
            onDeleteBookmark={onDeleteBookmark}
            onAddCurrentBookmark={onAddCurrentBookmark}
          />
        )}
      </div>

      {/* Bottom Tabs Switcher */}
      <nav className="sidebar-bottom-nav" aria-label="Sidebar navigation">
        <button
          type="button"
          className={`sidebar-nav-tab ${activeTab === 'contents' ? 'active' : ''}`}
          onClick={() => onTabChange('contents')}
        >
          <List size={16} />
          <span>{t('reader.contentsTab')}</span>
        </button>

        <button
          type="button"
          className={`sidebar-nav-tab ${activeTab === 'annotations' ? 'active' : ''}`}
          onClick={() => onTabChange('annotations')}
        >
          <Edit3 size={16} />
          <span>{t('reader.annotationsTab')}</span>
        </button>

        <button
          type="button"
          className={`sidebar-nav-tab ${activeTab === 'bookmarks' ? 'active' : ''}`}
          onClick={() => onTabChange('bookmarks')}
        >
          <BookmarkIcon size={16} />
          <span>{t('reader.bookmarksTab')}</span>
        </button>
      </nav>
    </aside>
  );
};

