import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from '../../i18n';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  footer,
  maxWidth = '520px',
}) => {
  const { t } = useTranslation();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-container"
        style={{ maxWidth }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-drag-handle" />
        {title && (
          <div className="modal-header">
            <div className="modal-header-title-row">
              <h3 className="modal-title">{title}</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={onClose}
                aria-label={t('common.close')}
              >
                <X size={18} />
              </button>
            </div>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
};
