import React, { useRef, useEffect } from 'react';
import { ReaderSettings, ThemeName } from '../../types/reader';
import { isMobileDevice } from '../../services/systemUi';
import {
  BookOpen,
  Scroll,
  Minus,
  Plus,
  X,
} from 'lucide-react';

interface SettingsPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ReaderSettings;
  onUpdateSettings: (newSettings: Partial<ReaderSettings>) => void;
  triggerRef?: React.RefObject<HTMLElement | null>;
}

export const SettingsPopover: React.FC<SettingsPopoverProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  triggerRef,
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);
  const isMobile = isMobileDevice();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (
        isOpen &&
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        (!triggerRef?.current || !triggerRef.current.contains(e.target as Node))
      ) {
        onClose();
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen, onClose, triggerRef]);

  if (!isOpen) return null;

  const themes: { id: ThemeName; label: string; bg: string; color: string; border: string }[] = [
    { id: 'light', label: 'Light', bg: '#ffffff', color: '#2e3436', border: '#deddda' },
    { id: 'sepia', label: 'Sepia', bg: '#fbf0d9', color: '#5f4b32', border: '#ebd5ab' },
    { id: 'solarized', label: 'Solarized', bg: '#fdf6e3', color: '#657b83', border: '#eee8d5' },
    { id: 'gray', label: 'Gray', bg: '#2e3440', color: '#eceff4', border: '#4c566a' },
    { id: 'dark', label: 'Dark', bg: '#1e1e1e', color: '#dedede', border: '#444444' },
  ];

  const fontOptions = [
    { label: 'System (Default)', value: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif' },
    { label: 'Georgia (Serif)', value: 'Georgia, serif' },
    { label: 'Merriweather', value: 'Merriweather, Georgia, serif' },
    { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
    { label: 'Arial / Helvetica', value: 'Arial, Helvetica, sans-serif' },
    { label: 'OpenDyslexic', value: 'OpenDyslexic, sans-serif' },
    { label: 'Monospace', value: 'ui-monospace, monospace' },
  ];

  return (
    <>
      {/* Backdrop overlay for tap-outside dismiss on mobile & desktop */}
      <div
        className="settings-popover-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className="settings-popover"
        ref={popoverRef}
        role="dialog"
        aria-modal="true"
        aria-label="Appearance & Reader Settings"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Mobile Drag Handle & Header */}
        <div className="settings-header-bar">
          <div className="settings-drag-handle" />
          <div className="settings-header-title-row">
            <h3 className="settings-title">Appearance</h3>
            <button
              type="button"
              className="settings-close-btn"
              onClick={onClose}
              title="Close Settings"
              aria-label="Close Settings"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Theme Selection */}
        <div className="settings-section">
          <label className="settings-label">Theme</label>
          <div className="theme-selector-grid">
            {themes.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`theme-pill ${settings.theme === t.id ? 'active' : ''}`}
                style={{ backgroundColor: t.bg, color: t.color, borderColor: t.border }}
                onClick={() => onUpdateSettings({ theme: t.id })}
                title={t.label}
              >
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="settings-divider" />

        {/* Layout / Flow Mode */}
        <div className="settings-section">
          <label className="settings-label">Layout</label>
          <div className="segmented-control">
            <button
              type="button"
              className={`segmented-btn ${settings.flow === 'paginated' ? 'active' : ''}`}
              onClick={() => onUpdateSettings({ flow: 'paginated' })}
            >
              <BookOpen size={16} />
              <span>Paginated</span>
            </button>
            <button
              type="button"
              className={`segmented-btn ${settings.flow === 'scrolled' ? 'active' : ''}`}
              onClick={() => onUpdateSettings({ flow: 'scrolled' })}
            >
              <Scroll size={16} />
              <span>Scrolled</span>
            </button>
          </div>
        </div>

        {settings.flow === 'paginated' && (
          <div className="settings-section">
            <label className="settings-label">Columns</label>
            <div className="segmented-control">
              <button
                type="button"
                className={`segmented-btn ${settings.columns === 'auto' ? 'active' : ''}`}
                onClick={() => onUpdateSettings({ columns: 'auto' })}
              >
                Auto
              </button>
              <button
                type="button"
                className={`segmented-btn ${settings.columns === 1 ? 'active' : ''}`}
                onClick={() => onUpdateSettings({ columns: 1 })}
              >
                1
              </button>
              <button
                type="button"
                className={`segmented-btn ${settings.columns === 2 ? 'active' : ''}`}
                onClick={() => onUpdateSettings({ columns: 2 })}
              >
                2
              </button>
            </div>
          </div>
        )}

        {/* Page Turn Mode (Mobile only) */}
        {isMobile && (
          <>
            <div className="settings-divider" />
            <div className="settings-section">
              <div className="settings-row-between" style={{ marginBottom: 6 }}>
                <label className="settings-label">Page Turn (Mobile)</label>
                <span className="settings-val-text">
                  {(!settings.pageTurnMethod || settings.pageTurnMethod === 'both')
                    ? 'Tap & Swipe'
                    : settings.pageTurnMethod === 'tap'
                    ? 'Tap only'
                    : 'Swipe only'}
                </span>
              </div>
              <div className="segmented-control">
                <button
                  type="button"
                  className={`segmented-btn ${settings.pageTurnMethod === 'tap' ? 'active' : ''}`}
                  onClick={() => onUpdateSettings({ pageTurnMethod: 'tap' })}
                >
                  <span>Tap</span>
                </button>
                <button
                  type="button"
                  className={`segmented-btn ${settings.pageTurnMethod === 'swipe' ? 'active' : ''}`}
                  onClick={() => onUpdateSettings({ pageTurnMethod: 'swipe' })}
                >
                  <span>Swipe</span>
                </button>
                <button
                  type="button"
                  className={`segmented-btn ${(!settings.pageTurnMethod || settings.pageTurnMethod === 'both') ? 'active' : ''}`}
                  onClick={() => onUpdateSettings({ pageTurnMethod: 'both' })}
                >
                  <span>Both</span>
                </button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, marginBottom: 0 }}>
                {settings.pageTurnMethod === 'swipe'
                  ? 'Swipe horizontally to turn pages'
                  : 'Tap: 30% left to go back, 70% right to advance'}
              </p>
            </div>
          </>
        )}

        <div className="settings-divider" />

        {/* Font Family */}
        <div className="settings-section">
          <label className="settings-label">Font Family</label>
          <select
            className="settings-select"
            value={settings.fontFamily}
            onChange={(e) => onUpdateSettings({ fontFamily: e.target.value })}
          >
            {fontOptions.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>

        {/* Font Size */}
        <div className="settings-section">
          <div className="settings-row-between">
            <label className="settings-label">Font Size</label>
            <span className="settings-val-text">{settings.fontSize}px</span>
          </div>
          <div className="stepper-control">
            <button
              type="button"
              className="stepper-btn"
              onClick={() => onUpdateSettings({ fontSize: Math.max(12, settings.fontSize - 1) })}
              title="Decrease Font Size"
              aria-label="Decrease Font Size"
            >
              <Minus size={16} />
            </button>
            <input
              type="range"
              min={12}
              max={36}
              step={1}
              value={settings.fontSize}
              onChange={(e) => onUpdateSettings({ fontSize: Number(e.target.value) })}
              className="settings-slider"
              aria-label="Font Size Slider"
            />
            <button
              type="button"
              className="stepper-btn"
              onClick={() => onUpdateSettings({ fontSize: Math.min(36, settings.fontSize + 1) })}
              title="Increase Font Size"
              aria-label="Increase Font Size"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        {/* Line Spacing */}
        <div className="settings-section">
          <div className="settings-row-between">
            <label className="settings-label">Line Spacing</label>
            <span className="settings-val-text">{settings.spacing.toFixed(1)}</span>
          </div>
          <div className="stepper-control">
            <button
              type="button"
              className="stepper-btn"
              onClick={() => onUpdateSettings({ spacing: Math.max(1.0, Math.round((settings.spacing - 0.1) * 10) / 10) })}
              title="Decrease Line Spacing"
              aria-label="Decrease Line Spacing"
            >
              <Minus size={16} />
            </button>
            <input
              type="range"
              min={1.0}
              max={2.4}
              step={0.1}
              value={settings.spacing}
              onChange={(e) => onUpdateSettings({ spacing: parseFloat(e.target.value) })}
              className="settings-slider"
              aria-label="Line Spacing Slider"
            />
            <button
              type="button"
              className="stepper-btn"
              onClick={() => onUpdateSettings({ spacing: Math.min(2.4, Math.round((settings.spacing + 0.1) * 10) / 10) })}
              title="Increase Line Spacing"
              aria-label="Increase Line Spacing"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        {/* Margins */}
        <div className="settings-section">
          <div className="settings-row-between">
            <label className="settings-label">Margins</label>
            <span className="settings-val-text">{settings.margin}px</span>
          </div>
          <div className="stepper-control">
            <button
              type="button"
              className="stepper-btn"
              onClick={() => onUpdateSettings({ margin: Math.max(8, settings.margin - 4) })}
              title="Decrease Margins"
              aria-label="Decrease Margins"
            >
              <Minus size={16} />
            </button>
            <input
              type="range"
              min={8}
              max={120}
              step={4}
              value={settings.margin}
              onChange={(e) => onUpdateSettings({ margin: Number(e.target.value) })}
              className="settings-slider"
              aria-label="Margin Slider"
            />
            <button
              type="button"
              className="stepper-btn"
              onClick={() => onUpdateSettings({ margin: Math.min(120, settings.margin + 4) })}
              title="Increase Margins"
              aria-label="Increase Margins"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        <div className="settings-divider" />

        {/* Text Alignment & Hyphenation Toggles */}
        <div className="settings-section">
          <div className="settings-toggle-row">
            <span>Justify Text</span>
            <button
              type="button"
              className={`toggle-switch ${settings.justify ? 'checked' : ''}`}
              onClick={() => onUpdateSettings({ justify: !settings.justify })}
              role="switch"
              aria-checked={settings.justify}
              aria-label="Toggle Text Justification"
            >
              <span className="toggle-thumb" />
            </button>
          </div>
          <div className="settings-toggle-row">
            <span>Hyphenation</span>
            <button
              type="button"
              className={`toggle-switch ${settings.hyphenate ? 'checked' : ''}`}
              onClick={() => onUpdateSettings({ hyphenate: !settings.hyphenate })}
              role="switch"
              aria-checked={settings.hyphenate}
              aria-label="Toggle Hyphenation"
            >
              <span className="toggle-thumb" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

