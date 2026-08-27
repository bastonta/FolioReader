import React from 'react';
import { BookOpen, Folder } from 'lucide-react';
import { LocalBookFile } from '../../types/browse';
import { LocalBookCacheItem } from '../../services/storage';

interface FolderStackCoverProps {
  books: LocalBookFile[];
  metaCache: Record<string, LocalBookCacheItem>;
  compact?: boolean;
}

export const FolderStackCover: React.FC<FolderStackCoverProps> = ({
  books,
  metaCache,
  compact = false,
}) => {
  // Take up to 4 covers for the stack
  const stackBooks = books.slice(0, 4);
  const count = stackBooks.length;

  if (count === 0) {
    return (
      <div className={`folder-stack-empty ${compact ? 'compact' : ''}`}>
        <Folder size={compact ? 24 : 40} />
      </div>
    );
  }

  // If 1 book in folder
  if (count === 1) {
    const book = stackBooks[0];
    const meta = metaCache[book.id];
    const title = meta?.title || book.fileName.replace(/\.[^/.]+$/, '');
    const coverUrl = meta?.coverUrl;

    return (
      <div className={`folder-stack-wrap count-1 ${compact ? 'compact' : ''}`}>
        <div className="folder-stack-single-card">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={title}
              className="folder-stack-img"
              loading="lazy"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="folder-stack-fallback-cover">
              <BookOpen size={compact ? 16 : 24} />
              {!compact && <span className="folder-fallback-title">{title}</span>}
            </div>
          )}
        </div>
      </div>
    );
  }

  // If 2 books in folder
  if (count === 2) {
    return (
      <div className={`folder-stack-wrap count-2 ${compact ? 'compact' : ''}`}>
        {stackBooks.map((book, idx) => {
          const meta = metaCache[book.id];
          const title = meta?.title || book.fileName.replace(/\.[^/.]+$/, '');
          const coverUrl = meta?.coverUrl;
          const isFront = idx === stackBooks.length - 1;

          return (
            <div
              key={book.id}
              className={`folder-stack-layer stack-2-layer-${idx} ${isFront ? 'front' : 'back'}`}
            >
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt={title}
                  className="folder-stack-img"
                  loading="lazy"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              ) : (
                <div className="folder-stack-fallback-cover">
                  <BookOpen size={compact ? 14 : 20} />
                  {!compact && isFront && <span className="folder-fallback-title">{title}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // If 3 or 4 books in folder
  return (
    <div className={`folder-stack-wrap count-multi ${compact ? 'compact' : ''}`}>
      {stackBooks.map((book, idx) => {
        const meta = metaCache[book.id];
        const title = meta?.title || book.fileName.replace(/\.[^/.]+$/, '');
        const coverUrl = meta?.coverUrl;
        const isFront = idx === stackBooks.length - 1;

        return (
          <div
            key={book.id}
            className={`folder-stack-layer stack-multi-layer-${idx} ${isFront ? 'front' : 'back'}`}
            style={{ zIndex: idx + 1 }}
          >
            {coverUrl ? (
              <img
                src={coverUrl}
                alt={title}
                className="folder-stack-img"
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            ) : (
              <div className="folder-stack-fallback-cover">
                <BookOpen size={compact ? 12 : 18} />
                {!compact && isFront && <span className="folder-fallback-title">{title}</span>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
