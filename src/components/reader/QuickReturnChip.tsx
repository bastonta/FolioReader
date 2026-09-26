import React, { useEffect } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';

export interface QuickReturnChipProps {
  visible: boolean;
  direction: 'back' | 'forward';
  label: string;
  onClick: () => void;
  onDismiss: () => void;
  autoHideMs?: number;
}

export const QuickReturnChip: React.FC<QuickReturnChipProps> = ({
  visible,
  direction,
  label,
  onClick,
  onDismiss,
  autoHideMs = 9000,
}) => {
  useEffect(() => {
    if (!visible || !autoHideMs) return;
    const timer = setTimeout(() => {
      onDismiss();
    }, autoHideMs);
    return () => clearTimeout(timer);
  }, [visible, autoHideMs, onDismiss]);

  if (!visible) return null;

  return (
    <div
      className={`quick-return-chip-container ${visible ? 'visible' : ''}`}
      role="region"
      aria-label="Quick Return Navigation"
    >
      <button
        type="button"
        className="quick-return-chip-btn"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        title={label}
        aria-label={label}
      >
        {direction === 'back' && <ArrowLeft size={14} className="quick-return-icon" />}
        <span className="quick-return-label">{label}</span>
        {direction === 'forward' && <ArrowRight size={14} className="quick-return-icon" />}
      </button>

      <button
        type="button"
        className="quick-return-close-btn"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        title="Dismiss"
        aria-label="Dismiss"
      >
        <X size={12} />
      </button>
    </div>
  );
};
