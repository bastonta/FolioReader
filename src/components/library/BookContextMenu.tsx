import React, { useEffect, useRef, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, Circle, RotateCcw, Trash2 } from 'lucide-react';

export interface BookContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  isRead?: boolean;
  onClose: () => void;
  onMarkAsRead: () => void;
  onOpenResetModal: () => void;
  onDeleteBook: () => void;
}

export const BookContextMenu: React.FC<BookContextMenuProps> = ({
  isOpen,
  position,
  isRead = false,
  onClose,
  onMarkAsRead,
  onOpenResetModal,
  onDeleteBook,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const [adjustedPos, setAdjustedPos] = useState<{ top: number; left: number }>({
    top: position.y,
    left: position.x,
  });

  // Calculate position and prevent overflowing the viewport
  useLayoutEffect(() => {
    if (!isOpen || !menuRef.current) return;

    const menuEl = menuRef.current;
    const rect = menuEl.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = position.x;
    let top = position.y;

    // Check right edge
    if (left + rect.width > viewportWidth - 12) {
      left = Math.max(12, position.x - rect.width);
    }

    // Check bottom edge
    if (top + rect.height > viewportHeight - 12) {
      top = Math.max(12, position.y - rect.height);
    }

    setAdjustedPos({ top, left });
  }, [isOpen, position]);

  // Handle Escape key and outside clicks
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleScrollOrResize = () => {
      onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside, true);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside, true);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const content = (
    <div
      ref={menuRef}
      className="book-context-menu"
      style={{
        position: 'fixed',
        top: adjustedPos.top,
        left: adjustedPos.left,
        zIndex: 9999,
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* 1. Mark as Read / Unread */}
      <button
        type="button"
        className="book-context-menu-item"
        onClick={() => {
          onMarkAsRead();
          onClose();
        }}
      >
        {isRead ? (
          <>
            <Circle size={16} className="context-menu-icon" />
            <span>Mark as unread</span>
          </>
        ) : (
          <>
            <CheckCircle2 size={16} className="context-menu-icon" style={{ color: 'var(--accent-color)' }} />
            <span>Mark as read</span>
          </>
        )}
      </button>

      {/* 2. Reset state */}
      <button
        type="button"
        className="book-context-menu-item"
        onClick={() => {
          onClose();
          onOpenResetModal();
        }}
      >
        <RotateCcw size={16} className="context-menu-icon" />
        <span>Reset reading progress...</span>
      </button>

      <div className="book-context-menu-divider" />

      {/* 3. Delete from device */}
      <button
        type="button"
        className="book-context-menu-item danger"
        onClick={() => {
          onClose();
          onDeleteBook();
        }}
      >
        <Trash2 size={16} className="context-menu-icon" />
        <span>Delete from device</span>
      </button>
    </div>
  );

  return createPortal(content, document.body);
};
