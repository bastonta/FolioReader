import React from 'react';
import { Modal } from '../common/Modal';
import { Smartphone, Globe, RotateCcw, AlertCircle } from 'lucide-react';

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
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Reset Book Progress"
      maxWidth="480px"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%' }}>
          <button
            type="button"
            className="auth-btn-secondary"
            onClick={onClose}
          >
            Cancel
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
              <p className="reset-modal-book-meta">Current progress: {currentPercent}%</p>
            )}
          </div>
        </div>

        <p className="reset-modal-description">
          Choose where to reset your reading position and progress status:
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
              <span className="reset-option-title">On this device only</span>
              <span className="reset-option-subtitle">
                Resets reading progress locally. Data on the Folio server will remain unchanged.
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
              <span className="reset-option-title">Everywhere (device & server)</span>
              <span className="reset-option-subtitle">
                Resets reading progress locally and deletes saved progress from the Folio server.
              </span>
            </div>
          </button>
        </div>

        {isOffline && (
          <div className="reset-modal-offline-hint">
            <AlertCircle size={14} />
            <span>Device is offline. Server reset will take effect once connection is restored.</span>
          </div>
        )}
      </div>
    </Modal>
  );
};
