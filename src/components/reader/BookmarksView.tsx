import React from 'react';
import { Bookmark } from '../../types/reader';
import { Bookmark as BookmarkIcon, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from '../../i18n';

interface BookmarksViewProps {
  bookmarks: Bookmark[];
  onSelectBookmark: (bookmark: Bookmark) => void;
  onDeleteBookmark: (id: string) => void;
  onAddCurrentBookmark: () => void;
}

export const BookmarksView: React.FC<BookmarksViewProps> = ({
  bookmarks,
  onSelectBookmark,
  onDeleteBookmark,
  onAddCurrentBookmark,
}) => {
  const { t } = useTranslation();

  return (
    <div className="bookmarks-view-container">
      <div className="bookmarks-action-bar">
        <button
          type="button"
          className="add-bookmark-btn"
          onClick={onAddCurrentBookmark}
        >
          <Plus size={16} />
          <span>{t('reader.bookmarkCurrentPage')}</span>
        </button>
      </div>

      <div className="bookmarks-list-scroll">
        {bookmarks.length === 0 ? (
          <div className="sidebar-empty-state">
            <BookmarkIcon size={28} className="empty-state-icon" />
            <p>{t('reader.noBookmarks')}</p>
          </div>
        ) : (
          <div className="bookmarks-cards-list">
            {bookmarks.map((bm) => (
              <div
                key={bm.id}
                className="bookmark-card"
                onClick={() => onSelectBookmark(bm)}
              >
                <div className="bookmark-card-main">
                  <BookmarkIcon size={16} className="bookmark-icon-accent" />
                  <div className="bookmark-card-text">
                    <h5 className="bookmark-chapter-title">
                      {bm.chapterTitle || bm.locationLabel || t('reader.pageBookmark')}
                    </h5>
                    {bm.textSnippet && (
                      <p className="bookmark-snippet">{bm.textSnippet}</p>
                    )}
                  </div>
                </div>

                <div className="bookmark-card-footer">
                  <span className="bookmark-time">
                    {bm.createdAt
                      ? new Date(bm.createdAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : ''}
                  </span>
                  <button
                    type="button"
                    className="bookmark-delete-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteBookmark(bm.id);
                    }}
                    title={t('reader.deleteBookmark')}
                    aria-label={t('reader.deleteBookmark')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

