import React, { useRef, useEffect, useState } from 'react';
import { ReaderSettings, ThemeName, ScreenTimeoutOption } from '../../types/reader';
import { isMobileDevice } from '../../services/systemUi';
import { fontManager } from '../../services/fontManager';
import { LoadedCustomFont } from '../../types/font';
import { Select } from '../common/Select';
import {
  BookOpen,
  Scroll,
  Minus,
  Plus,
  X,
} from 'lucide-react';
import { useTranslation } from '../../i18n';

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
  const { t } = useTranslation();
  const popoverRef = useRef<HTMLDivElement>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const isMobile = isMobileDevice();
  const [customFonts, setCustomFonts] = useState<LoadedCustomFont[]>(() => fontManager.getCachedFonts());
  const [isUploadingFont, setIsUploadingFont] = useState(false);

  useEffect(() => {
    fontManager.loadAllFonts().then(setCustomFonts);
    const unsubscribe = fontManager.subscribe(setCustomFonts);
    return () => unsubscribe();
  }, []);

  const handleFontUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsUploadingFont(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const loaded = await fontManager.addFontFile(file);
        if (i === 0) {
          onUpdateSettings({ fontFamily: `'${loaded.fontFamily}', sans-serif` });
        }
      }
    } catch (err) {
      console.error('Failed to upload custom font:', err);
    } finally {
      setIsUploadingFont(false);
      if (fontInputRef.current) {
        fontInputRef.current.value = '';
      }
    }
  };

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
    { id: 'light', label: t('reader.themeLight'), bg: '#ffffff', color: '#2e3436', border: '#deddda' },
    { id: 'sepia', label: t('reader.themeSepia'), bg: '#fbf0d9', color: '#5f4b32', border: '#ebd5ab' },
    { id: 'solarized', label: t('reader.themeSolarized'), bg: '#fdf6e3', color: '#657b83', border: '#eee8d5' },
    { id: 'gray', label: t('reader.themeGray'), bg: '#2e3440', color: '#eceff4', border: '#4c566a' },
    { id: 'dark', label: t('reader.themeDark'), bg: '#1e1e1e', color: '#dedede', border: '#444444' },
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

  const getFontWeightLabel = (weight: number = 400) => {
    switch (weight) {
      case 300:
        return '300 (Light)';
      case 400:
        return '400 (Regular)';
      case 500:
        return '500 (Medium)';
      case 600:
        return '600 (Semi-Bold)';
      case 700:
        return '700 (Bold)';
      case 800:
        return '800 (Extra Bold)';
      case 900:
        return '900 (Black)';
      default:
        return `${weight}`;
    }
  };

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
        aria-label={t('reader.appearance')}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Mobile Drag Handle & Header */}
        <div className="settings-header-bar">
          <div className="settings-drag-handle" />
          <div className="settings-header-title-row">
            <h3 className="settings-title">{t('reader.appearance')}</h3>
            <button
              type="button"
              className="settings-close-btn"
              onClick={onClose}
              title={t('common.close')}
              aria-label={t('common.close')}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Theme Selection */}
        <div className="settings-section">
          <label className="settings-label">{t('reader.theme')}</label>
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
          <label className="settings-label">{t('reader.layout')}</label>
          <div className="segmented-control">
            <button
              type="button"
              className={`segmented-btn ${settings.flow === 'paginated' ? 'active' : ''}`}
              onClick={() => onUpdateSettings({ flow: 'paginated' })}
            >
              <BookOpen size={16} />
              <span>{t('reader.flowPaginated')}</span>
            </button>
            <button
              type="button"
              className={`segmented-btn ${settings.flow === 'scrolled' ? 'active' : ''}`}
              onClick={() => onUpdateSettings({ flow: 'scrolled' })}
            >
              <Scroll size={16} />
              <span>{t('reader.flowScrolled')}</span>
            </button>
          </div>
        </div>

        {settings.flow === 'paginated' && (
          <div className="settings-section">
            <label className="settings-label">{t('reader.columns')}</label>
            <div className="segmented-control">
              <button
                type="button"
                className={`segmented-btn ${settings.columns === 'auto' ? 'active' : ''}`}
                onClick={() => onUpdateSettings({ columns: 'auto' })}
              >
                {t('reader.columnsAuto')}
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
                <label className="settings-label">{t('reader.pageTurnMobile')}</label>
                <span className="settings-val-text">
                  {(!settings.pageTurnMethod || settings.pageTurnMethod === 'both')
                    ? t('reader.pageTurnTapSwipe')
                    : settings.pageTurnMethod === 'tap'
                    ? t('reader.pageTurnTapOnly')
                    : t('reader.pageTurnSwipeOnly')}
                </span>
              </div>
              <div className="segmented-control">
                <button
                  type="button"
                  className={`segmented-btn ${settings.pageTurnMethod === 'tap' ? 'active' : ''}`}
                  onClick={() => onUpdateSettings({ pageTurnMethod: 'tap' })}
                >
                  <span>{t('reader.tap')}</span>
                </button>
                <button
                  type="button"
                  className={`segmented-btn ${settings.pageTurnMethod === 'swipe' ? 'active' : ''}`}
                  onClick={() => onUpdateSettings({ pageTurnMethod: 'swipe' })}
                >
                  <span>{t('reader.swipe')}</span>
                </button>
                <button
                  type="button"
                  className={`segmented-btn ${(!settings.pageTurnMethod || settings.pageTurnMethod === 'both') ? 'active' : ''}`}
                  onClick={() => onUpdateSettings({ pageTurnMethod: 'both' })}
                >
                  <span>{t('reader.both')}</span>
                </button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, marginBottom: 0 }}>
                {settings.pageTurnMethod === 'swipe'
                  ? t('reader.swipeDesc')
                  : t('reader.tapDesc')}
              </p>
            </div>

            <div className="settings-divider" />

            {/* Volume Buttons Page Turn (Mobile) */}
            <div className="settings-section">
              <div className="settings-toggle-row">
                <span className="settings-label" style={{ marginBottom: 0 }}>{t('reader.volumeKeysTitle')}</span>
                <button
                  type="button"
                  className={`toggle-switch ${settings.volumeKeysPageTurn !== false ? 'checked' : ''}`}
                  onClick={() => onUpdateSettings({ volumeKeysPageTurn: settings.volumeKeysPageTurn === false ? true : false })}
                  role="switch"
                  aria-checked={settings.volumeKeysPageTurn !== false}
                  aria-label={t('reader.volumeKeysTitle')}
                >
                  <span className="toggle-thumb" />
                </button>
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, marginBottom: settings.volumeKeysPageTurn !== false ? 8 : 0 }}>
                {settings.volumeKeysInverted ? t('reader.volumeKeysInvertedDesc') : t('reader.volumeKeysDesc')}
              </p>

              {settings.volumeKeysPageTurn !== false && (
                <div className="settings-toggle-row" style={{ paddingTop: 6, borderTop: '1px dashed var(--border-subtle)' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('reader.invertButtons')}</span>
                  <button
                    type="button"
                    className={`toggle-switch ${settings.volumeKeysInverted ? 'checked' : ''}`}
                    onClick={() => onUpdateSettings({ volumeKeysInverted: !settings.volumeKeysInverted })}
                    role="switch"
                    aria-checked={Boolean(settings.volumeKeysInverted)}
                    aria-label={t('reader.invertButtons')}
                  >
                    <span className="toggle-thumb" />
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        <div className="settings-divider" />

        {/* Screen Timeout & Sleep */}
        <div className="settings-section">
          <div className="settings-row-between" style={{ marginBottom: 6 }}>
            <label className="settings-label" style={{ marginBottom: 0 }}>{t('reader.screenTimeout')}</label>
          </div>
          <Select<ScreenTimeoutOption>
            value={settings.screenTimeout || '5'}
            onChange={(val) => onUpdateSettings({ screenTimeout: val })}
            options={[
              { value: 'system', label: t('settings.screenTimeoutSystem') },
              { value: '2', label: t('settings.screenTimeoutMinutes', { count: 2 }) },
              { value: '5', label: t('settings.screenTimeoutMinutes', { count: 5 }) },
              { value: '10', label: t('settings.screenTimeoutMinutes', { count: 10 }) },
              { value: '15', label: t('settings.screenTimeoutMinutes', { count: 15 }) },
              { value: '30', label: t('settings.screenTimeoutMinutes', { count: 30 }) },
              { value: 'never', label: t('settings.screenTimeoutNever') },
            ]}
            aria-label={t('reader.screenTimeout')}
          />
          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, marginBottom: 0 }}>
            {settings.screenTimeout === 'never'
              ? t('settings.screenTimeoutNeverDesc')
              : settings.screenTimeout === 'system'
              ? t('settings.screenTimeoutSystemDesc')
              : t('settings.screenTimeoutMinutesDesc', { count: settings.screenTimeout || 5 })}
          </p>
        </div>

        <div className="settings-divider" />

        {/* Font Family */}
        <div className="settings-section">
          <div className="settings-row-between" style={{ marginBottom: 6 }}>
            <label className="settings-label" style={{ marginBottom: 0 }}>{t('reader.fontFamily')}</label>
            <button
              type="button"
              className="settings-font-add-btn"
              onClick={() => fontInputRef.current?.click()}
              disabled={isUploadingFont}
              title="Add custom font (.ttf, .otf, .woff, .woff2)"
            >
              <Plus size={12} />
              <span>{isUploadingFont ? '...' : t('reader.addFont')}</span>
            </button>
          </div>

          <input
            ref={fontInputRef}
            type="file"
            accept=".ttf,.otf,.woff,.woff2"
            multiple
            style={{ display: 'none' }}
            onChange={handleFontUpload}
          />

          <Select<string>
            value={settings.fontFamily}
            onChange={(val) => onUpdateSettings({ fontFamily: val })}
            groups={[
              {
                label: t('reader.standardFonts'),
                options: fontOptions.map((f) => ({
                  value: f.value,
                  label: f.label,
                  style: { fontFamily: f.value },
                })),
              },
              ...(customFonts.length > 0
                ? [
                    {
                      label: t('reader.customFonts'),
                      options: customFonts.map((f) => ({
                        value: `'${f.fontFamily}', sans-serif`,
                        label: f.name,
                        style: { fontFamily: `'${f.fontFamily}', sans-serif` },
                      })),
                    },
                  ]
                : []),
            ]}
            aria-label={t('reader.fontFamily')}
          />
        </div>

        {/* Font Size */}
        <div className="settings-section">
          <div className="settings-row-between">
            <label className="settings-label">{t('reader.fontSize')}</label>
            <span className="settings-val-text">{settings.fontSize}px</span>
          </div>
          <div className="stepper-control">
            <button
              type="button"
              className="stepper-btn"
              onClick={() => onUpdateSettings({ fontSize: Math.max(12, settings.fontSize - 1) })}
              title={t('reader.fontSize')}
              aria-label={t('reader.fontSize')}
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
              aria-label={t('reader.fontSize')}
            />
            <button
              type="button"
              className="stepper-btn"
              onClick={() => onUpdateSettings({ fontSize: Math.min(36, settings.fontSize + 1) })}
              title={t('reader.fontSize')}
              aria-label={t('reader.fontSize')}
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        {/* Font Weight */}
        <div className="settings-section">
          <div className="settings-row-between">
            <label className="settings-label">{t('reader.fontWeight')}</label>
            <span className="settings-val-text">{getFontWeightLabel(settings.fontWeight || 400)}</span>
          </div>
          <div className="stepper-control">
            <button
              type="button"
              className="stepper-btn"
              onClick={() => onUpdateSettings({ fontWeight: Math.max(300, (settings.fontWeight || 400) - 100) })}
              title={t('reader.fontWeight')}
              aria-label={t('reader.fontWeight')}
            >
              <Minus size={16} />
            </button>
            <input
              type="range"
              min={300}
              max={900}
              step={100}
              value={settings.fontWeight || 400}
              onChange={(e) => onUpdateSettings({ fontWeight: Number(e.target.value) })}
              className="settings-slider"
              aria-label={t('reader.fontWeight')}
            />
            <button
              type="button"
              className="stepper-btn"
              onClick={() => onUpdateSettings({ fontWeight: Math.min(900, (settings.fontWeight || 400) + 100) })}
              title={t('reader.fontWeight')}
              aria-label={t('reader.fontWeight')}
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        {/* Line Spacing */}
        <div className="settings-section">
          <div className="settings-row-between">
            <label className="settings-label">{t('reader.lineSpacing')}</label>
            <span className="settings-val-text">{settings.spacing.toFixed(1)}</span>
          </div>
          <div className="stepper-control">
            <button
              type="button"
              className="stepper-btn"
              onClick={() => onUpdateSettings({ spacing: Math.max(1.0, Math.round((settings.spacing - 0.1) * 10) / 10) })}
              title={t('reader.lineSpacing')}
              aria-label={t('reader.lineSpacing')}
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
              aria-label={t('reader.lineSpacing')}
            />
            <button
              type="button"
              className="stepper-btn"
              onClick={() => onUpdateSettings({ spacing: Math.min(2.4, Math.round((settings.spacing + 0.1) * 10) / 10) })}
              title={t('reader.lineSpacing')}
              aria-label={t('reader.lineSpacing')}
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        {/* Margins */}
        <div className="settings-section">
          <div className="settings-row-between">
            <label className="settings-label">{t('reader.margins')}</label>
            <span className="settings-val-text">{settings.margin}px</span>
          </div>
          <div className="stepper-control">
            <button
              type="button"
              className="stepper-btn"
              onClick={() => onUpdateSettings({ margin: Math.max(8, settings.margin - 4) })}
              title={t('reader.margins')}
              aria-label={t('reader.margins')}
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
              aria-label={t('reader.margins')}
            />
            <button
              type="button"
              className="stepper-btn"
              onClick={() => onUpdateSettings({ margin: Math.min(120, settings.margin + 4) })}
              title={t('reader.margins')}
              aria-label={t('reader.margins')}
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        <div className="settings-divider" />

        {/* Text Alignment & Hyphenation Toggles */}
        <div className="settings-section">
          <div className="settings-toggle-row">
            <span>{t('reader.justifyText')}</span>
            <button
              type="button"
              className={`toggle-switch ${settings.justify ? 'checked' : ''}`}
              onClick={() => onUpdateSettings({ justify: !settings.justify })}
              role="switch"
              aria-checked={settings.justify}
              aria-label={t('reader.justifyText')}
            >
              <span className="toggle-thumb" />
            </button>
          </div>
          <div className="settings-toggle-row">
            <span>{t('reader.hyphenation')}</span>
            <button
              type="button"
              className={`toggle-switch ${settings.hyphenate ? 'checked' : ''}`}
              onClick={() => onUpdateSettings({ hyphenate: !settings.hyphenate })}
              role="switch"
              aria-checked={settings.hyphenate}
              aria-label={t('reader.hyphenation')}
            >
              <span className="toggle-thumb" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

