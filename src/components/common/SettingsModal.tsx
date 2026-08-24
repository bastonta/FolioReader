import React, { useState, useEffect, useRef } from 'react';
import { ReaderSettings, ThemeName } from '../../types/reader';
import { fileManager } from '../../services/fileManager';
import { fontManager } from '../../services/fontManager';
import { LoadedCustomFont } from '../../types/font';
import { isMobileDevice } from '../../services/systemUi';
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
} from 'lucide-react';
import { APP_VERSION, BUILD_TIME, formatBuildTime } from '../../constants/buildInfo';


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
  const [isPicking, setIsPicking] = useState(false);
  const [hasPermission, setHasPermission] = useState(true);
  const [customFonts, setCustomFonts] = useState<LoadedCustomFont[]>(() => fontManager.getCachedFonts());
  const [isUploadingFont, setIsUploadingFont] = useState(false);
  const [fontError, setFontError] = useState<string | null>(null);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const isMobile = isMobileDevice();

  useEffect(() => {
    if (isOpen) {
      fileManager.hasStoragePermission().then(setHasPermission);
      fontManager.loadAllFonts().then(setCustomFonts);
      const unsubscribe = fontManager.subscribe(setCustomFonts);
      return () => unsubscribe();
    }
  }, [isOpen]);

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
    if (window.confirm(`Delete font "${fileName}"?`)) {
      await fontManager.deleteFont(fileName);
    }
  };

  const handleOpenFontsFolder = async () => {
    await fontManager.openFontsFolder();
  };

  if (!isOpen) return null;

  const themes: { id: ThemeName; label: string; bg: string; color: string; border: string }[] = [
    { id: 'light', label: 'Light', bg: '#ffffff', color: '#2e3436', border: '#deddda' },
    { id: 'sepia', label: 'Sepia', bg: '#fbf0d9', color: '#5f4b32', border: '#ebd5ab' },
    { id: 'solarized', label: 'Solarized', bg: '#fdf6e3', color: '#657b83', border: '#eee8d5' },
    { id: 'gray', label: 'Gray', bg: '#2e3440', color: '#eceff4', border: '#4c566a' },
    { id: 'dark', label: 'Dark', bg: '#1e1e1e', color: '#dedede', border: '#444444' },
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
            <span className="modal-title">App Settings</span>
            <button className="modal-close-btn" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          
          {/* Theme Settings */}
          <div className="settings-block">
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
              <span>Theme</span>
            </label>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                gap: 8,
              }}
            >
              {themes.map((t) => {
                const isActive = settings.theme === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    className={`theme-pill ${isActive ? 'active' : ''}`}
                    style={{
                      backgroundColor: t.bg,
                      color: t.color,
                      borderColor: isActive ? 'var(--accent-color)' : t.border,
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
                    onClick={() => onUpdateSettings({ theme: t.id })}
                  >
                    <span>{t.label}</span>
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
                  Storage Access Required
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, marginBottom: 8 }}>
                  To download, save, and scan local books on Android, storage permission is required.
                </div>
                <button
                  type="button"
                  className="auth-btn-primary"
                  style={{ padding: '6px 12px', fontSize: 12 }}
                  onClick={handleRequestPermission}
                >
                  Grant Permission
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
              <span>Download & Books Folder</span>
            </label>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
              The app automatically scans all books in this folder and saves new downloads into it.
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
                {settings.downloadPath || 'No folder selected'}
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
                <span>{isPicking ? 'Selecting...' : 'Select Folder'}</span>
              </button>

              <button
                type="button"
                className="auth-btn-secondary"
                style={{ padding: '8px 14px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                onClick={handleResetToDefault}
              >
                <RotateCcw size={14} />
                <span>Default</span>
              </button>
            </div>

            {/* Android Presets */}
            {isMobile && (
              <div style={{ marginTop: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                  Quick Android Folder Presets:
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
                    Automatically Create Series Folders
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, lineHeight: 1.35 }}>
                    Books belonging to a series will be saved inside a subfolder named after the series
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
                aria-label="Toggle automatic series folders creation"
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
              <span>Library & Catalog View</span>
            </label>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
              Choose how books and folders are displayed by default in your library and catalog.
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
                <span>Grid</span>
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
                <span>List</span>
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
                <span>Mobile Page Turn Gestures</span>
              </label>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                Choose how pages are turned on mobile devices. Tap uses 30% left to go back and 70% right to advance.
              </p>

              <div className="segmented-control" style={{ width: '100%', height: 38 }}>
                <button
                  type="button"
                  className={`segmented-btn ${settings.pageTurnMethod === 'tap' ? 'active' : ''}`}
                  onClick={() => onUpdateSettings({ pageTurnMethod: 'tap' })}
                  style={{ height: '100%', fontSize: 13 }}
                >
                  Tap
                </button>
                <button
                  type="button"
                  className={`segmented-btn ${settings.pageTurnMethod === 'swipe' ? 'active' : ''}`}
                  onClick={() => onUpdateSettings({ pageTurnMethod: 'swipe' })}
                  style={{ height: '100%', fontSize: 13 }}
                >
                  Swipe
                </button>
                <button
                  type="button"
                  className={`segmented-btn ${(!settings.pageTurnMethod || settings.pageTurnMethod === 'both') ? 'active' : ''}`}
                  onClick={() => onUpdateSettings({ pageTurnMethod: 'both' })}
                  style={{ height: '100%', fontSize: 13 }}
                >
                  Both
                </button>
              </div>
            </div>
          )}

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
                <span>Custom Reader Fonts</span>
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                {!isMobile && (
                  <button
                    type="button"
                    className="settings-font-folder-btn"
                    onClick={handleOpenFontsFolder}
                    title="Open local fonts folder in file explorer"
                  >
                    <FolderOpen size={13} />
                    <span>Open Folder</span>
                  </button>
                )}
                <button
                  type="button"
                  className="settings-font-add-btn"
                  onClick={() => fontInputRef.current?.click()}
                  disabled={isUploadingFont}
                  title="Add custom font (.ttf, .otf, .woff, .woff2)"
                >
                  <Plus size={13} />
                  <span>{isUploadingFont ? 'Adding...' : 'Add Font'}</span>
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
              Add font files (.ttf, .otf, .woff, .woff2) to use in the reader. Fonts are stored permanently on your device.
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
                No custom fonts added yet. Click &quot;Add Font&quot; to load your favorite fonts.
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
                      title={`Delete font ${font.name}`}
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
              <span>About Folio</span>
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
                <span style={{ color: 'var(--text-muted)' }}>Application Version</span>
                <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontFamily: 'monospace' }}>
                  v{APP_VERSION}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Calendar size={13} />
                  <span>Build Date</span>
                </span>
                <span style={{ color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                  {formatBuildTime(BUILD_TIME)}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)' }}>Platform</span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {isMobile ? 'Android (Mobile)' : 'Desktop'}
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
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
