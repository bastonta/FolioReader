import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
} from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
  HelpCircle,
  X,
} from 'lucide-react';
import { useTranslation } from '../i18n';
import { useBackHandler } from '../services/backHandler';

export type DialogType = 'info' | 'success' | 'warning' | 'error' | 'danger' | 'confirm';

export interface AlertOptions {
  title?: string;
  message: React.ReactNode;
  confirmText?: string;
  type?: 'info' | 'success' | 'warning' | 'error';
}

export interface ConfirmOptions {
  title?: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  type?: 'info' | 'warning' | 'danger' | 'confirm';
}

export interface DialogContextValue {
  alert: (options: string | AlertOptions) => Promise<void>;
  confirm: (options: string | ConfirmOptions) => Promise<boolean>;
}

interface DialogItem {
  id: number;
  isConfirm: boolean;
  title?: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  isDestructive?: boolean;
  type?: DialogType;
  resolve: (value: any) => void;
}

const DialogContext = createContext<DialogContextValue | null>(null);

let nextDialogId = 1;

export const DialogProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { t } = useTranslation();
  const [dialogs, setDialogs] = useState<DialogItem[]>([]);
  const currentDialog = dialogs[0] || null;
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  const alert = useCallback((options: string | AlertOptions): Promise<void> => {
    return new Promise<void>((resolve) => {
      const opts: AlertOptions =
        typeof options === 'string' ? { message: options } : options;
      const item: DialogItem = {
        id: nextDialogId++,
        isConfirm: false,
        title: opts.title,
        message: opts.message,
        confirmText: opts.confirmText,
        type: opts.type || 'info',
        resolve: () => resolve(),
      };
      setDialogs((prev) => [...prev, item]);
    });
  }, []);

  const confirm = useCallback(
    (options: string | ConfirmOptions): Promise<boolean> => {
      return new Promise<boolean>((resolve) => {
        const opts: ConfirmOptions =
          typeof options === 'string' ? { message: options } : options;
        const item: DialogItem = {
          id: nextDialogId++,
          isConfirm: true,
          title: opts.title,
          message: opts.message,
          confirmText: opts.confirmText,
          cancelText: opts.cancelText,
          isDestructive: opts.isDestructive,
          type: opts.type || (opts.isDestructive ? 'danger' : 'confirm'),
          resolve: (confirmed: boolean) => resolve(confirmed),
        };
        setDialogs((prev) => [...prev, item]);
      });
    },
    []
  );

  const handleConfirm = useCallback(() => {
    if (!currentDialog) return;
    const { resolve, isConfirm } = currentDialog;
    setDialogs((prev) => prev.slice(1));
    resolve(isConfirm ? true : undefined);
  }, [currentDialog]);

  const handleCancel = useCallback(() => {
    if (!currentDialog) return;
    const { resolve, isConfirm } = currentDialog;
    setDialogs((prev) => prev.slice(1));
    resolve(isConfirm ? false : undefined);
  }, [currentDialog]);

  // Handle hardware back on Android and Escape key on desktop with high priority
  useBackHandler(
    () => {
      handleCancel();
      return true;
    },
    Boolean(currentDialog),
    200
  );

  // Autofocus the primary action button when a dialog opens
  useEffect(() => {
    if (currentDialog) {
      const timer = setTimeout(() => {
        confirmBtnRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [currentDialog?.id]);

  // Keyboard Enter key support
  useEffect(() => {
    if (!currentDialog) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        // Only trigger if active element is not cancel button
        if (document.activeElement?.getAttribute('data-action') !== 'cancel') {
          e.preventDefault();
          handleConfirm();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentDialog, handleConfirm]);

  const renderIcon = () => {
    if (!currentDialog) return null;
    const type = currentDialog.type || (currentDialog.isDestructive ? 'danger' : 'info');

    switch (type) {
      case 'danger':
        return <AlertTriangle className="dialog-icon" size={20} />;
      case 'error':
        return <AlertCircle className="dialog-icon" size={20} />;
      case 'warning':
        return <AlertTriangle className="dialog-icon" size={20} />;
      case 'success':
        return <CheckCircle2 className="dialog-icon" size={20} />;
      case 'confirm':
        return <HelpCircle className="dialog-icon" size={20} />;
      case 'info':
      default:
        return <Info className="dialog-icon" size={20} />;
    }
  };

  const getEffectiveTitle = () => {
    if (!currentDialog) return '';
    if (currentDialog.title) return currentDialog.title;

    const type = currentDialog.type || (currentDialog.isDestructive ? 'danger' : 'info');
    switch (type) {
      case 'danger':
      case 'confirm':
        return t('common.confirmation');
      case 'error':
        return t('common.error');
      case 'warning':
        return t('common.warning');
      case 'success':
      case 'info':
      default:
        return t('common.notice');
    }
  };

  const effectiveConfirmText =
    currentDialog?.confirmText ||
    (currentDialog?.isConfirm
      ? currentDialog.isDestructive
        ? t('common.delete')
        : t('common.confirm')
      : t('common.ok'));

  const effectiveCancelText = currentDialog?.cancelText || t('common.cancel');

  return (
    <DialogContext.Provider value={{ alert, confirm }}>
      {children}

      {currentDialog && (
        <div
          className="dialog-backdrop"
          onClick={handleCancel}
          role="presentation"
        >
          <div
            className="dialog-container"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            aria-describedby="dialog-message"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="dialog-header">
              <div className={`dialog-icon-wrapper dialog-icon-${currentDialog.type || (currentDialog.isDestructive ? 'danger' : 'info')}`}>
                {renderIcon()}
              </div>
              <div className="dialog-header-text">
                <h3 id="dialog-title" className="dialog-title">
                  {getEffectiveTitle()}
                </h3>
              </div>
              <button
                type="button"
                className="dialog-close-btn"
                onClick={handleCancel}
                aria-label={t('common.close')}
              >
                <X size={18} />
              </button>
            </div>

            <div id="dialog-message" className="dialog-body">
              {currentDialog.message}
            </div>

            <div className="dialog-footer">
              {currentDialog.isConfirm && (
                <button
                  type="button"
                  className="dialog-btn dialog-btn-secondary"
                  data-action="cancel"
                  onClick={handleCancel}
                >
                  {effectiveCancelText}
                </button>
              )}
              <button
                ref={confirmBtnRef}
                type="button"
                className={`dialog-btn ${
                  currentDialog.isDestructive
                    ? 'dialog-btn-danger'
                    : 'dialog-btn-primary'
                }`}
                data-action="confirm"
                onClick={handleConfirm}
              >
                {effectiveConfirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </DialogContext.Provider>
  );
};

export const useDialog = (): DialogContextValue => {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error('useDialog must be used within a DialogProvider');
  }
  return context;
};
