import React from 'react';
import { Modal } from '../common/Modal';
import { Smartphone, Globe, RotateCcw, AlertCircle } from 'lucide-react';
import { useTranslation } from '../../i18n';

export interface ResetProgressModalProps {
  isOpen: boolean;
  bookTitle: string;
  currentPercent?: number;
  isOffline?: boolean;
  onClose: () => void;
  onConfirmReset: (resetOnServer: boolean) => void;
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
          <button
            type="button"
            className="auth-btn-secondary"
            onClick={onClose}
          >
            {t('common.cancel')}
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

        <div className="reset-modal-options">
          {/* Option 1: Client only */}
          <button
            type="button"
            className="reset-option-card"
            onClick={() => {
              onConfirmReset(false);
              onClose();
            }}
          >
            <div className="reset-option-icon-wrap">
              <Smartphone size={22} />
            </div>
            <div className="reset-option-text">
              <span className="reset-option-title">{t('resetModal.deviceOnlyTitle')}</span>
              <span className="reset-option-subtitle">
                {t('resetModal.deviceOnlyDesc')}
              </span>
            </div>
          </button>

          {/* Option 2: Everywhere (Client & Server) */}
          <button
            type="button"
            className="reset-option-card server-option"
            onClick={() => {
              onConfirmReset(true);
              onClose();
            }}
          >
            <div className="reset-option-icon-wrap server-icon">
              <Globe size={22} />
            </div>
            <div className="reset-option-text">
              <span className="reset-option-title">{t('resetModal.serverTitle')}</span>
              <span className="reset-option-subtitle">
                {t('resetModal.serverDesc')}
              </span>
            </div>
          </button>
        </div>

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
