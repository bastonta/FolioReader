import React, { useState, useEffect, useRef } from 'react';
import { ReaderSettings, ThemeName, ScreenTimeoutOption } from '../../types/reader';
import { fileManager } from '../../services/fileManager';
import { fontManager } from '../../services/fontManager';
import { LoadedCustomFont } from '../../types/font';
import { isMobileDevice } from '../../services/systemUi';
import { useTranslation, Language } from '../../i18n';
import { useDialog } from '../../context/DialogContext';
import { Select } from './Select';
import {
  X,
  Folder,
  FolderOpen,
  Palette,
  RotateCcw,
  Layers,
  Check,
  ShieldAlert,
  HardDrive,
  Smartphone,
  LayoutGrid,
  List as ListIcon,
  Type,
  Trash2,
  Plus,
  Info,
  Calendar,
  Volume2,
  Clock,
  Globe,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { APP_VERSION, BUILD_TIME, formatBuildTime } from '../../constants/buildInfo';
import {
  checkForUpdates,
  getLastUpdateCheckTime,
  UpdateInfo,
  UpdateCheckResult,
} from '../../services/updateChecker';
import { UpdateModal } from './UpdateModal';


interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: ReaderSettings;
  onUpdateSettings: (newSettings: Partial<ReaderSettings>) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
}) => {
  const { t, setLanguage } = useTranslation();
  const { confirm } = useDialog();
  const [isPicking, setIsPicking] = useState(false);
  const [hasPermission, setHasPermission] = useState(true);
  const [customFonts, setCustomFonts] = useState<LoadedCustomFont[]>(() => fontManager.getCachedFonts());
  const [isUploadingFont, setIsUploadingFont] = useState(false);
  const [fontError, setFontError] = useState<string | null>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const isMobile = isMobileDevice();

  // Update check states
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [lastCheckTime, setLastCheckTime] = useState<string | null>(() => getLastUpdateCheckTime());
  const [activeUpdateInfo, setActiveUpdateInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    if (isOpen) {
      fileManager.hasStoragePermission().then(setHasPermission);
      fontManager.loadAllFonts().then(setCustomFonts);
      setLastCheckTime(getLastUpdateCheckTime());
      const unsubscribe = fontManager.subscribe(setCustomFonts);
      return () => unsubscribe();
    }
  }, [isOpen]);

  const handleCheckUpdates = async () => {
    setIsCheckingUpdate(true);
    setUpdateResult(null);
    try {
      const result = await checkForUpdates({
        auto: false,
        includePrereleases: settings.includePrereleases,
      });
      setUpdateResult(result);
      setLastCheckTime(new Date().toISOString());
      if (result.status === 'update-available' && result.updateInfo) {
        setActiveUpdateInfo(result.updateInfo);
      }
    } catch (err: any) {
      setUpdateResult({
        status: 'error',
        error: err?.message || 'Failed to check for updates',
      });
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleFontUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsUploadingFont(true);
    setFontError(null);
    try {
      for (let i = 0; i < files.length; i++) {
        await fontManager.addFontFile(files[i]);
      }
    } catch (err: any) {
      console.error('Failed to add custom font:', err);
      setFontError(typeof err === 'string' ? err : 'Failed to save font file');
    } finally {
      setIsUploadingFont(false);
      if (fontInputRef.current) {
        fontInputRef.current.value = '';
      }
    }
  };

  const handleDeleteFont = async (fileName: string) => {
    const confirmed = await confirm({
      title: t('common.delete'),
      message: t('settings.deleteFontConfirm', { name: fileName }),
      confirmText: t('common.delete'),
      cancelText: t('common.cancel'),
      isDestructive: true,
    });
    if (confirmed) {
      await fontManager.deleteFont(fileName);
    }
  };

  const handleOpenFontsFolder = async () => {
    await fontManager.openFontsFolder();
  };

  if (!isOpen) return null;

  const languages: { id: Language; label: string }[] = [
    { id: 'system', label: t('language.system') },
    { id: 'ru', label: t('language.ru') },
    { id: 'en', label: t('language.en') },
  ];

  const themes: { id: ThemeName; label: string; bg: string; color: string; border: string }[] = [
    { id: 'light', label: t('theme.light'), bg: '#ffffff', color: '#2e3436', border: '#deddda' },
    { id: 'sepia', label: t('theme.sepia'), bg: '#fbf0d9', color: '#5f4b32', border: '#ebd5ab' },
    { id: 'solarized', label: t('theme.solarized'), bg: '#fdf6e3', color: '#657b83', border: '#eee8d5' },
    { id: 'gray', label: t('theme.gray'), bg: '#2e3440', color: '#eceff4', border: '#4c566a' },
    { id: 'dark', label: t('theme.dark'), bg: '#1e1e1e', color: '#dedede', border: '#444444' },
  ];

  const androidPresets = [
    { label: 'Download / FolioBooks', path: '/storage/emulated/0/Download/FolioBooks' },
    { label: 'Documents / FolioBooks', path: '/storage/emulated/0/Documents/FolioBooks' },
    { label: 'Books / Folio', path: '/storage/emulated/0/Books/Folio' },
  ];

  const handleRequestPermission = async () => {
    await fileManager.requestStoragePermission();
    setTimeout(async () => {
      const granted = await fileManager.hasStoragePermission();
      setHasPermission(granted);
    }, 1000);
  };

  const handlePickFolder = async () => {
    setIsPicking(true);
    try {
      const selected = await fileManager.pickFolder(settings.downloadPath);
      if (selected) {
        onUpdateSettings({ downloadPath: selected });
      }
    } finally {
      setIsPicking(false);
    }
  };

  const handleResetToDefault = async () => {
    const defaultDir = await fileManager.getDefaultDownloadDir();
    if (defaultDir) {
      onUpdateSettings({ downloadPath: defaultDir });
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-container"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-drag-handle" />
        <div className="modal-header">
          <div className="modal-header-title-row">
            <span className="modal-title">{t('settings.title')}</span>
            <button className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          
          {/* Language Settings */}
          <div className="settings-block">
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--text-primary)',
                marginBottom: 6,
              }}
            >
              <Globe size={18} style={{ color: 'var(--accent-color)' }} />
              <span>{t('language.title')}</span>
            </label>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              {t('language.desc')}
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: 8,
              }}
            >
              {languages.map((l) => {
                const isActive = (settings.language || 'system') === l.id;
                return (
                  <button
                    key={l.id}
                    type="button"
                    className={`theme-pill ${isActive ? 'active' : ''}`}
                    style={{
                      borderColor: isActive ? 'var(--accent-color)' : 'var(--border-color)',
                      borderWidth: isActive ? 2 : 1,
                      borderStyle: 'solid',
                      padding: '0 12px',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 13,
                      fontWeight: isActive ? 700 : 500,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: 42,
                      gap: 8,
                    }}
                    onClick={() => {
                      onUpdateSettings({ language: l.id });
                      setLanguage(l.id);
                    }}
                  >
                    <span>{l.label}</span>
                    {isActive && <Check size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Theme Settings */}
          <div className="settings-block" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--text-primary)',
                marginBottom: 10,
              }}
            >
              <Palette size={18} style={{ color: 'var(--accent-color)' }} />
              <span>{t('theme.title')}</span>
            </label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: 8,
              }}
            >
              {themes.map((tItem) => {
                const isActive = settings.theme === tItem.id;
                return (
                  <button
                    key={tItem.id}
                    type="button"
                    className={`theme-pill ${isActive ? 'active' : ''}`}
                    style={{
                      backgroundColor: tItem.bg,
                      color: tItem.color,
                      borderColor: isActive ? 'var(--accent-color)' : tItem.border,
                      borderWidth: isActive ? 2 : 1,
                      borderStyle: 'solid',
                      padding: '0 12px',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 13,
                      fontWeight: isActive ? 700 : 500,
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: 42,
                      boxSizing: 'border-box',
                      gap: 8,
                    }}
                    onClick={() => onUpdateSettings({ theme: tItem.id })}
                  >
                    <span>{tItem.label}</span>
                    {isActive && <Check size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Permission warning banner for Android */}
          {isMobile && !hasPermission && (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: '12px 14px',
                backgroundColor: 'rgba(234, 179, 8, 0.12)',
                border: '1px solid rgba(234, 179, 8, 0.35)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
              }}
            >
              <ShieldAlert size={20} style={{ color: '#eab308', flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#ca8a04' }}>
                  {t('common.storageRequired')}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, marginBottom: 8 }}>
                  {t('common.storageRequiredDesc')}
                </div>
                <button
                  type="button"
                  className="auth-btn-primary"
                  style={{ padding: '6px 12px', fontSize: 12 }}
                  onClick={handleRequestPermission}
                >
                  {t('common.grantPermission')}
                </button>
              </div>
            </div>
          )}

          {/* Download Folder Settings */}
          <div className="settings-block">
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--text-primary)',
                marginBottom: 6,
              }}
            >
              <Folder size={18} style={{ color: 'var(--accent-color)' }} />
              <span>{t('settings.downloadFolder')}</span>
            </label>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
              {t('settings.downloadFolderDesc')}
            </p>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 14px',
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                marginBottom: 10,
                wordBreak: 'break-all',
                overflowWrap: 'anywhere',
                fontFamily: 'monospace',
                fontSize: 12,
                color: 'var(--text-primary)',
              }}
            >
              <FolderOpen size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <span style={{ flex: 1, wordBreak: 'break-all', overflowWrap: 'anywhere' }}>
                {settings.downloadPath || t('settings.noFolderSelected')}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: isMobile ? 12 : 0 }}>
              <button
                type="button"
                className="auth-btn-primary"
                style={{ padding: '8px 16px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                onClick={handlePickFolder}
                disabled={isPicking}
              >
                <FolderOpen size={15} />
                <span>{isPicking ? t('common.selecting') : t('settings.selectFolder')}</span>
              </button>

              <button
                type="button"
                className="auth-btn-secondary"
                style={{ padding: '8px 14px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                onClick={handleResetToDefault}
              >
                <RotateCcw size={14} />
                <span>{t('common.default')}</span>
              </button>
            </div>

            {/* Android Presets */}
            {isMobile && (
              <div style={{ marginTop: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                  {t('settings.quickAndroidPresets')}
                </span>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {androidPresets.map((preset) => (
                    <button
                      key={preset.path}
                      type="button"
                      className={`theme-pill ${settings.downloadPath === preset.path ? 'active' : ''}`}
                      style={{
                        padding: '5px 10px',
                        fontSize: 11,
                        borderRadius: 'var(--radius-md)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                      onClick={() => onUpdateSettings({ downloadPath: preset.path })}
                    >
                      <HardDrive size={12} />
                      <span>{preset.label}</span>
                      {settings.downloadPath === preset.path && <Check size={12} />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Series Folder Option */}
          <div className="settings-block" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                cursor: 'pointer',
              }}
              onClick={() => onUpdateSettings({ createSeriesFolder: !settings.createSeriesFolder })}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Layers size={18} style={{ color: 'var(--accent-color)' }} />
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {t('settings.seriesFolderTitle')}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.35 }}>
                    {t('settings.seriesFolderDesc')}
                  </div>
                </div>
              </div>

              <button
                type="button"
                className={`toggle-switch ${settings.createSeriesFolder !== false ? 'checked' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdateSettings({ createSeriesFolder: !settings.createSeriesFolder });
                }}
                role="switch"
                aria-checked={settings.createSeriesFolder !== false}
                aria-label={t('settings.seriesFolderTitle')}
              >
                <span className="toggle-thumb" />
              </button>
            </div>
          </div>

          {/* Library & Catalog Display Mode */}
          <div className="settings-block" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--text-primary)',
                marginBottom: 6,
              }}
            >
              <LayoutGrid size={18} style={{ color: 'var(--accent-color)' }} />
              <span>{t('settings.libraryViewTitle')}</span>
            </label>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
              {t('settings.libraryViewDesc')}
            </p>

            <div className="segmented-control" style={{ width: '100%', height: 38 }}>
              <button
                type="button"
                className={`segmented-btn ${(settings.libraryViewMode || 'grid') === 'grid' ? 'active' : ''}`}
                onClick={() => {
                  localStorage.setItem('folio_library_view_mode', 'grid');
                  onUpdateSettings({ libraryViewMode: 'grid' });
                }}
                style={{ height: '100%', fontSize: 13, gap: 8 }}
              >
                <LayoutGrid size={16} />
                <span>{t('settings.viewGrid')}</span>
              </button>
              <button
                type="button"
                className={`segmented-btn ${settings.libraryViewMode === 'list' ? 'active' : ''}`}
                onClick={() => {
                  localStorage.setItem('folio_library_view_mode', 'list');
                  onUpdateSettings({ libraryViewMode: 'list' });
                }}
                style={{ height: '100%', fontSize: 13, gap: 8 }}
              >
                <ListIcon size={16} />
                <span>{t('settings.viewList')}</span>
              </button>
            </div>
          </div>

          {/* Page Turn Mode for Mobile */}
          {isMobile && (
            <div className="settings-block" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  marginBottom: 6,
                }}
              >
                <Smartphone size={18} style={{ color: 'var(--accent-color)' }} />
                <span>{t('settings.mobileGesturesTitle')}</span>
              </label>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                {t('settings.mobileGesturesDesc')}
              </p>

              <div className="segmented-control" style={{ width: '100%', height: 38 }}>
                <button
                  type="button"
                  className={`segmented-btn ${settings.pageTurnMethod === 'tap' ? 'active' : ''}`}
                  onClick={() => onUpdateSettings({ pageTurnMethod: 'tap' })}
                  style={{ height: '100%', fontSize: 13 }}
                >
                  {t('settings.gestureTap')}
                </button>
                <button
                  type="button"
                  className={`segmented-btn ${settings.pageTurnMethod === 'swipe' ? 'active' : ''}`}
                  onClick={() => onUpdateSettings({ pageTurnMethod: 'swipe' })}
                  style={{ height: '100%', fontSize: 13 }}
                >
                  {t('settings.gestureSwipe')}
                </button>
                <button
                  type="button"
                  className={`segmented-btn ${(!settings.pageTurnMethod || settings.pageTurnMethod === 'both') ? 'active' : ''}`}
                  onClick={() => onUpdateSettings({ pageTurnMethod: 'both' })}
                  style={{ height: '100%', fontSize: 13 }}
                >
                  {t('settings.gestureBoth')}
                </button>
              </div>
            </div>
          )}

          {/* Volume Buttons Page Turn for Mobile */}
          {isMobile && (
            <div className="settings-block" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  marginBottom: 6,
                }}
              >
                <Volume2 size={18} style={{ color: 'var(--accent-color)' }} />
                <span>{t('settings.volumeButtonsTitle')}</span>
              </label>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                {t('settings.volumeButtonsDesc')}
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div
                  className="settings-toggle-row"
                  style={{ cursor: 'pointer' }}
                  onClick={() => onUpdateSettings({ volumeKeysPageTurn: settings.volumeKeysPageTurn === false ? true : false })}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                      {t('settings.turnPagesWithVolume')}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {settings.volumeKeysInverted ? t('settings.volumeKeysInvertedHint') : t('settings.volumeKeysNormalHint')}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={`toggle-switch ${settings.volumeKeysPageTurn !== false ? 'checked' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateSettings({ volumeKeysPageTurn: settings.volumeKeysPageTurn === false ? true : false });
                    }}
                    role="switch"
                    aria-checked={settings.volumeKeysPageTurn !== false}
                    aria-label={t('settings.turnPagesWithVolume')}
                  >
                    <span className="toggle-thumb" />
                  </button>
                </div>

                {settings.volumeKeysPageTurn !== false && (
                  <div
                    className="settings-toggle-row"
                    style={{ cursor: 'pointer', paddingTop: 8, borderTop: '1px dashed var(--border-subtle)' }}
                    onClick={() => onUpdateSettings({ volumeKeysInverted: !settings.volumeKeysInverted })}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                        {t('settings.invertVolumeButtons')}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {t('settings.invertVolumeHint')}
                      </span>
                    </div>
                    <button
                      type="button"
                      className={`toggle-switch ${settings.volumeKeysInverted ? 'checked' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onUpdateSettings({ volumeKeysInverted: !settings.volumeKeysInverted });
                      }}
                      role="switch"
                      aria-checked={Boolean(settings.volumeKeysInverted)}
                      aria-label={t('settings.invertVolumeButtons')}
                    >
                      <span className="toggle-thumb" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Screen Timeout Setting */}
          <div className="settings-block" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--text-primary)',
                marginBottom: 6,
              }}
            >
              <Clock size={18} style={{ color: 'var(--accent-color)' }} />
              <span>{t('settings.screenTimeoutTitle')}</span>
            </label>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              {t('settings.screenTimeoutDesc')}
            </p>

            <Select<ScreenTimeoutOption>
              value={settings.screenTimeout || '5'}
              onChange={(val) => onUpdateSettings({ screenTimeout: val })}
              options={[
                { value: 'system', label: t('settings.screenTimeoutSystem') },
                { value: '2', label: t('settings.screenTimeout2m') },
                { value: '5', label: t('settings.screenTimeout5m') },
                { value: '10', label: t('settings.screenTimeout10m') },
                { value: '15', label: t('settings.screenTimeout15m') },
                { value: '30', label: t('settings.screenTimeout30m') },
                { value: 'never', label: t('settings.screenTimeoutNever') },
              ]}
              aria-label={t('settings.screenTimeoutTitle')}
            />
          </div>

          {/* Custom Reader Fonts Section */}
          <div className="settings-block" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  margin: 0,
                }}
              >
                <Type size={18} style={{ color: 'var(--accent-color)' }} />
                <span>{t('settings.customFontsTitle')}</span>
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                {!isMobile && (
                  <button
                    type="button"
                    className="settings-font-folder-btn"
                    onClick={handleOpenFontsFolder}
                    title={t('settings.openFontFolder')}
                  >
                    <FolderOpen size={13} />
                    <span>{t('settings.openFontFolder')}</span>
                  </button>
                )}
                <button
                  type="button"
                  className="settings-font-add-btn"
                  onClick={() => fontInputRef.current?.click()}
                  disabled={isUploadingFont}
                  title={t('settings.addFont')}
                >
                  <Plus size={13} />
                  <span>{isUploadingFont ? t('settings.addingFont') : t('settings.addFont')}</span>
                </button>
              </div>
            </div>

            <input
              ref={fontInputRef}
              type="file"
              accept=".ttf,.otf,.woff,.woff2"
              multiple
              style={{ display: 'none' }}
              onChange={handleFontUpload}
            />

            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
              {t('settings.customFontsDesc')}
            </p>

            {fontError && (
              <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 8 }}>
                {fontError}
              </div>
            )}

            {customFonts.length === 0 ? (
              <div
                style={{
                  padding: '16px',
                  backgroundColor: 'var(--bg-secondary)',
                  border: '1px dashed var(--border-color)',
                  borderRadius: 'var(--radius-md)',
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  fontSize: 12,
                }}
              >
                {t('settings.noCustomFonts')}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {customFonts.map((font) => (
                  <div
                    key={font.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      backgroundColor: 'var(--bg-secondary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: 'var(--radius-md)',
                      gap: 12,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <span
                          style={{
                            fontSize: 14,
                            fontWeight: 600,
                            color: 'var(--text-primary)',
                            fontFamily: `'${font.fontFamily}', sans-serif`,
                          }}
                        >
                          {font.name}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            padding: '1px 5px',
                            backgroundColor: 'rgba(59, 130, 246, 0.1)',
                            color: 'var(--accent-color)',
                            borderRadius: 4,
                          }}
                        >
                          {font.format}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {(font.fileSize / 1024).toFixed(0)} KB
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: 'var(--text-secondary)',
                          fontFamily: `'${font.fontFamily}', sans-serif`,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        The quick brown fox jumps over the lazy dog • 1234567890
                      </div>
                    </div>

                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => handleDeleteFont(font.fileName)}
                      title={t('settings.deleteFontConfirm', { name: font.name })}
                      style={{
                        padding: 6,
                        borderRadius: 'var(--radius-sm)',
                        color: '#ef4444',
                        backgroundColor: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* App Updates Section */}
          <div className="settings-block" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  margin: 0,
                }}
              >
                <Sparkles size={18} style={{ color: 'var(--accent-color)' }} />
                <span>{t('update.title')}</span>
              </label>

              <button
                type="button"
                className="settings-action-btn"
                onClick={handleCheckUpdates}
                disabled={isCheckingUpdate}
                title={t('update.checkForUpdates')}
              >
                <RefreshCw
                  size={12}
                  style={{
                    animation: isCheckingUpdate ? 'spin 1s linear infinite' : 'none',
                  }}
                />
                <span>{isCheckingUpdate ? t('update.checking') : t('update.checkForUpdates')}</span>
              </button>
            </div>

            {/* Status Feedback */}
            {updateResult && (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: 12,
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  backgroundColor:
                    updateResult.status === 'update-available'
                      ? 'rgba(59, 130, 246, 0.12)'
                      : updateResult.status === 'error'
                      ? 'rgba(239, 68, 68, 0.12)'
                      : 'var(--bg-secondary)',
                  border: `1px solid ${
                    updateResult.status === 'update-available'
                      ? 'rgba(59, 130, 246, 0.3)'
                      : updateResult.status === 'error'
                      ? 'rgba(239, 68, 68, 0.3)'
                      : 'var(--border-color)'
                  }`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {updateResult.status === 'update-available' && (
                    <Sparkles size={16} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />
                  )}
                  {updateResult.status === 'up-to-date' && (
                    <CheckCircle2 size={16} style={{ color: '#16a34a', flexShrink: 0 }} />
                  )}
                  {updateResult.status === 'dev-build' && (
                    <CheckCircle2 size={16} style={{ color: '#ca8a04', flexShrink: 0 }} />
                  )}
                  {updateResult.status === 'error' && (
                    <AlertCircle size={16} style={{ color: '#ef4444', flexShrink: 0 }} />
                  )}

                  <span style={{ color: 'var(--text-primary)' }}>
                    {updateResult.status === 'update-available' &&
                      `${t('update.title')}: v${updateResult.updateInfo?.latestVersion}`}
                    {updateResult.status === 'up-to-date' &&
                      t('update.upToDate', { version: APP_VERSION })}
                    {updateResult.status === 'dev-build' &&
                      t('update.devBuild', { version: APP_VERSION })}
                    {updateResult.status === 'no-releases' && t('update.noReleasesFound')}
                    {updateResult.status === 'error' &&
                      (updateResult.error || t('update.checkFailed'))}
                  </span>
                </div>

                {updateResult.status === 'update-available' && updateResult.updateInfo && (
                  <button
                    type="button"
                    className="settings-action-btn-primary"
                    onClick={() => setActiveUpdateInfo(updateResult.updateInfo!)}
                  >
                    {t('update.viewUpdate')}
                  </button>
                )}
              </div>
            )}

            {/* Last checked caption */}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
              {lastCheckTime
                ? t('update.lastChecked', { time: formatBuildTime(lastCheckTime) })
                : t('update.neverChecked')}
            </div>

            {/* Toggles */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Auto check toggle */}
              <div
                className="settings-toggle-row"
                style={{ cursor: 'pointer' }}
                onClick={() =>
                  onUpdateSettings({ autoCheckUpdates: settings.autoCheckUpdates === false ? true : false })
                }
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                    {t('update.autoCheckTitle')}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {t('update.autoCheckDesc')}
                  </span>
                </div>
                <button
                  type="button"
                  className={`toggle-switch ${settings.autoCheckUpdates !== false ? 'checked' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdateSettings({
                      autoCheckUpdates: settings.autoCheckUpdates === false ? true : false,
                    });
                  }}
                  role="switch"
                  aria-checked={settings.autoCheckUpdates !== false}
                  aria-label={t('update.autoCheckTitle')}
                >
                  <span className="toggle-thumb" />
                </button>
              </div>

              {/* Include pre-releases toggle */}
              <div
                className="settings-toggle-row"
                style={{ cursor: 'pointer', paddingTop: 8, borderTop: '1px dashed var(--border-subtle)' }}
                onClick={() =>
                  onUpdateSettings({ includePrereleases: !settings.includePrereleases })
                }
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>
                    {t('update.includePrereleasesTitle')}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {t('update.includePrereleasesDesc')}
                  </span>
                </div>
                <button
                  type="button"
                  className={`toggle-switch ${settings.includePrereleases ? 'checked' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdateSettings({
                      includePrereleases: !settings.includePrereleases,
                    });
                  }}
                  role="switch"
                  aria-checked={Boolean(settings.includePrereleases)}
                  aria-label={t('update.includePrereleasesTitle')}
                >
                  <span className="toggle-thumb" />
                </button>
              </div>
            </div>
          </div>

          {/* About / App Information */}
          <div className="settings-block" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--text-primary)',
                marginBottom: 10,
              }}
            >
              <Info size={18} style={{ color: 'var(--accent-color)' }} />
              <span>{t('settings.aboutFolio')}</span>
            </label>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: '12px 14px',
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--radius-md)',
                fontSize: 12,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)' }}>{t('settings.appVersion')}</span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                  v{APP_VERSION}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Calendar size={13} />
                  <span>{t('common.buildDate')}</span>
                </span>
                <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                  {formatBuildTime(BUILD_TIME)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)' }}>{t('common.platform')}</span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {isMobile ? t('common.mobile') : t('common.desktop')}
                </span>
              </div>
            </div>
          </div>

        </div>

        <div
          className="modal-footer"
          style={{
            padding: '16px 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.3 }}>
            <span>Folio v{APP_VERSION}</span>
            <span style={{ margin: '0 5px' }}>•</span>
            <span>{formatBuildTime(BUILD_TIME)}</span>
          </div>
          <button type="button" className="auth-btn-primary" onClick={onClose} style={{ minWidth: 100 }}>
            {t('common.done')}
          </button>
        </div>
      </div>

      {/* Update Info Modal Dialog */}
      {activeUpdateInfo && (
        <UpdateModal
          isOpen={Boolean(activeUpdateInfo)}
          onClose={() => setActiveUpdateInfo(null)}
          updateInfo={activeUpdateInfo}
        />
      )}
    </div>
  );
};
