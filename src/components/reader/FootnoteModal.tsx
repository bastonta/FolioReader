import React, { useEffect, useMemo } from 'react';
import { X, ExternalLink } from 'lucide-react';
import DOMPurify from 'dompurify';
import { FootnoteData } from '../../types/reader';
import { useTranslation } from '../../i18n';

interface FootnoteModalProps {
  footnote: FootnoteData | null;
  onClose: () => void;
  onNavigate: (href: string) => void;
}

export const FootnoteModal: React.FC<FootnoteModalProps> = ({
  footnote,
  onClose,
  onNavigate,
}) => {
  const { t } = useTranslation();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (footnote) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [footnote, onClose]);

  const sanitizedHtml = useMemo(() => {
    if (!footnote?.contentHtml) return '';
    return DOMPurify.sanitize(footnote.contentHtml, { USE_PROFILES: { html: true } });
  }, [footnote?.contentHtml]);

  if (!footnote) return null;

  return (
    <div className="footnote-modal-backdrop" onClick={onClose}>
      <div
        className="footnote-modal-box"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="footnote-title"
        aria-modal="true"
      >
        <div className="footnote-modal-header">
          <h4 id="footnote-title" className="footnote-modal-title">
            {footnote.title || t('reader.note')}
          </h4>
          <button
            type="button"
            className="footnote-close-btn"
            onClick={onClose}
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X size={16} />
          </button>
        </div>

        <div
          className="footnote-modal-body"
          dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
        />

        <div className="footnote-modal-footer">
          <button
            type="button"
            className="footnote-btn footnote-btn-secondary"
            onClick={onClose}
          >
            {t('common.close')}
          </button>
          {footnote.href && (
            <button
              type="button"
              className="footnote-btn footnote-btn-primary"
              onClick={() => {
                onClose();
                onNavigate(footnote.href);
              }}
              title={t('reader.goToNote')}
            >
              <ExternalLink size={14} style={{ marginRight: 6 }} />
              {t('reader.goToNote')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

