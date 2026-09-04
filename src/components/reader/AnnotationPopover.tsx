import React, { useState, useEffect, useRef } from 'react';
import { Annotation, ANNOTATION_COLORS, getAnnotationColorKey } from '../../types/reader';
import { Copy, Trash2, Check, MessageSquare, MoreHorizontal } from 'lucide-react';
import { showOriginalContextMenu, isMobileDevice } from '../../services/systemUi';
import { useTranslation } from '../../i18n';

export interface SelectionInfo {
  text: string;
  cfi: string;
  sectionIndex: number;
  rect: { x: number; y: number; width: number; height: number };
  existingAnnotation?: Annotation;
}

interface AnnotationPopoverProps {
  selection: SelectionInfo | null;
  onClose: () => void;
  onShowOriginalMenu?: () => void;
  onSave: (annotation: {
    id?: string;
    value: string;
    text: string;
    color: string;
    style: 'highlight';
    note?: string;
    sectionIndex: number;
  }) => void;
  onDelete?: (idOrValue: string) => void;
}

export const AnnotationPopover: React.FC<AnnotationPopoverProps> = ({
  selection,
  onClose,
  onShowOriginalMenu,
  onSave,
  onDelete,
}) => {
  const { t } = useTranslation();
  const [selectedColor, setSelectedColor] = useState<string>('yellow');
  const [showNoteInput, setShowNoteInput] = useState<boolean>(false);
  const [noteText, setNoteText] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const isMobile = isMobileDevice();

  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selection?.existingAnnotation) {
      setSelectedColor(getAnnotationColorKey(selection.existingAnnotation.color));
      setNoteText(selection.existingAnnotation.note || '');
      setShowNoteInput(!!selection.existingAnnotation.note);
    } else {
      setSelectedColor('yellow');
      setNoteText('');
      setShowNoteInput(false);
    }
    setCopied(false);
  }, [selection]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | PointerEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener('pointerdown', handleClickOutside);
    window.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('pointerdown', handleClickOutside);
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  if (!selection) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(selection.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const handleShowOriginalMenu = (e: React.MouseEvent) => {
    e.stopPropagation();
    showOriginalContextMenu(selection.text, selection.rect);
    if (onShowOriginalMenu) {
      onShowOriginalMenu();
    } else {
      onClose();
    }
  };

  const handleSave = (color = selectedColor) => {
    const colorKey = getAnnotationColorKey(color);
    onSave({
      id: selection.existingAnnotation?.id,
      value: selection.cfi,
      text: selection.text,
      color: colorKey,
      style: 'highlight',
      note: noteText.trim() || undefined,
      sectionIndex: selection.sectionIndex,
    });
    onClose();
  };

  // Position calculation (clamped to screen boundaries with safe areas)
  const popoverWidth = Math.min(window.innerWidth - 20, 360);
  const popoverHeight = showNoteInput ? 170 : 44;

  let top = selection.rect.y - popoverHeight - 8;
  if (top < 10) {
    top = selection.rect.y + selection.rect.height + 8;
  }
  // Ensure popover stays within screen bounds (especially when virtual keyboard opens)
  top = Math.max(10, Math.min(window.innerHeight - popoverHeight - 10, top));

  let left = selection.rect.x + selection.rect.width / 2 - popoverWidth / 2;
  left = Math.max(10, Math.min(window.innerWidth - popoverWidth - 10, left));

  return (
    <div
      className="annotation-popover"
      ref={popoverRef}
      style={{
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        zIndex: 999,
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <div className="annotation-popover-main">
        {/* Color Palette */}
        <div className="annotation-color-picker">
          {Object.entries(ANNOTATION_COLORS).map(([key, c]) => (
            <button
              key={key}
              type="button"
              className={`color-dot-btn ${selectedColor === key ? 'active' : ''}`}
              style={{ backgroundColor: c.hex }}
              onClick={() => {
                setSelectedColor(key);
                handleSave(key);
              }}
              title={c.label}
              aria-label={c.label}
            />
          ))}
        </div>

        <div className="annotation-popover-divider" />

        {/* Note button */}
        <button
          type="button"
          className={`popover-action-btn ${showNoteInput ? 'active' : ''}`}
          onClick={() => setShowNoteInput(!showNoteInput)}
          title={t('reader.addNote')}
          aria-label={t('reader.addNote')}
        >
          <MessageSquare size={16} />
        </button>

        {/* Copy button */}
        <button
          type="button"
          className="popover-action-btn"
          onClick={handleCopy}
          title={t('reader.copyText')}
          aria-label={t('reader.copyText')}
        >
          {copied ? <Check size={16} className="text-success" /> : <Copy size={16} />}
        </button>

        {/* Original System Context Menu button (Mobile only) */}
        {isMobile && (
          <button
            type="button"
            className="popover-action-btn"
            onClick={handleShowOriginalMenu}
            title={t('reader.originalMenu')}
            aria-label={t('reader.originalMenu')}
          >
            <MoreHorizontal size={16} />
          </button>
        )}

        {/* Delete button (if existing annotation) */}
        {selection.existingAnnotation && onDelete && (
          <button
            type="button"
            className="popover-action-btn popover-action-delete"
            onClick={() => {
              onDelete(selection.existingAnnotation!.id || selection.existingAnnotation!.value);
              onClose();
            }}
            title={t('reader.deleteAnnotation')}
            aria-label={t('reader.deleteAnnotation')}
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {/* Note input expander */}
      {showNoteInput && (
        <div className="annotation-note-box">
          <textarea
            className="annotation-note-input"
            rows={2}
            placeholder={t('reader.addNotePlaceholder')}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleSave();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              }
            }}
            autoFocus
          />
          <div className="annotation-note-actions">
            <button
              type="button"
              className="note-action-btn note-save-btn"
              onClick={() => handleSave()}
            >
              {t('reader.saveNote')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

