import React from 'react';
import { Modal } from '../common/Modal';
import { RotateCcw, AlertCircle } from 'lucide-react';
import { useTranslation } from '../../i18n';

export interface ResetProgressModalProps {
  isOpen: boolean;
  bookTitle: string;
  currentPercent?: number;
  isOffline?: boolean;
  onClose: () => void;
  onConfirmReset: () => void;
}

export const ResetProgressModal: React.FC<ResetProgressModalProps> = ({
  isOpen,
  bookTitle,
  currentPercent,
  isOffline = false,
  onClose,
  onConfirmReset,
}) => {
  const { t } = useTranslation();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('resetModal.title')}
      maxWidth="480px"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', width: '100%' }}>
          <button
            type="button"
            className="dialog-btn dialog-btn-secondary"
            onClick={onClose}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="dialog-btn dialog-btn-danger"
            onClick={() => {
              onConfirmReset();
              onClose();
            }}
          >
            {t('resetModal.confirmButton')}
          </button>
        </div>
      }
    >
      <div className="reset-modal-content">
        <div className="reset-modal-book-info">
          <RotateCcw size={22} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />
          <div>
            <h4 className="reset-modal-book-title">{bookTitle}</h4>
            {currentPercent !== undefined && (
              <p className="reset-modal-book-meta">{t('resetModal.currentProgress', { percent: currentPercent })}</p>
            )}
          </div>
        </div>

        <p className="reset-modal-description">
          {t('resetModal.description')}
        </p>

        {isOffline && (
          <div className="reset-modal-offline-hint">
            <AlertCircle size={14} />
            <span>{t('resetModal.offlineHint')}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};
