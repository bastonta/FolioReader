import {
  ArrowLeft,
  ArrowRight,
  CloudDownload,
  Library,
  Loader2,
  PanelLeft,
  Sliders,
} from "lucide-react";
import React from "react";
import { useTranslation } from "../../i18n";

interface HeaderBarProps {
  onBackToLibrary: () => void;
  onToggleSidebar: () => void;
  isSidebarOpen: boolean;
  onHistoryBack?: () => void;
  onHistoryForward?: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  onToggleSettings?: () => void;
  isSettingsOpen?: boolean;
  settingsBtnRef?: React.RefObject<HTMLButtonElement | null>;
  chapterTitle?: string;
  /** Fetches new chapters; only given for a book built from chapters, not for a ready EPUB */
  onUpdateChapters?: () => void;
  isUpdatingChapters?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  onBackToLibrary,
  onToggleSidebar,
  isSidebarOpen,
  onHistoryBack,
  onHistoryForward,
  canGoBack = false,
  canGoForward = false,
  onToggleSettings,
  isSettingsOpen = false,
  settingsBtnRef,
  chapterTitle,
  onUpdateChapters,
  isUpdatingChapters = false,
  onMouseEnter,
  onMouseLeave,
}) => {
  const { t } = useTranslation();

  return (
    <header
      className="reader-header-bar"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Left Header Controls */}
      <div className="header-left-actions">
        {/* Back to Library */}
        <button
          type="button"
          className="header-icon-btn header-library-btn"
          onClick={onBackToLibrary}
          title={t('reader.backToLibrary')}
          aria-label={t('reader.backToLibrary')}
        >
          <Library size={16} />
        </button>

        <div className="header-separator" />

        {/* Sidebar Toggle Control */}
        <button
          type="button"
          className={`header-icon-btn ${isSidebarOpen ? "active" : ""}`}
          onClick={onToggleSidebar}
          title={
            isSidebarOpen
              ? t('reader.hideSidebar')
              : t('reader.showSidebar')
          }
          aria-label={
            isSidebarOpen
              ? t('reader.hideSidebar')
              : t('reader.showSidebar')
          }
        >
          <PanelLeft size={16} />
        </button>

        {/* Navigation History Controls */}
        {(onHistoryBack || onHistoryForward) && (
          <>
            <div className="header-separator" />
            <button
              type="button"
              className="header-icon-btn header-history-btn"
              onClick={onHistoryBack}
              disabled={!canGoBack}
              title={t('reader.historyBack')}
              aria-label={t('reader.historyBack')}
            >
              <ArrowLeft size={16} />
            </button>
            <button
              type="button"
              className="header-icon-btn header-history-btn"
              onClick={onHistoryForward}
              disabled={!canGoForward}
              title={t('reader.historyForward')}
              aria-label={t('reader.historyForward')}
            >
              <ArrowRight size={16} />
            </button>
          </>
        )}
      </div>

      {/* Center Running Head Title */}
      <div className="header-center-title">
        {chapterTitle && (
          <span className="header-chapter-name">{chapterTitle}</span>
        )}
      </div>

      {/* Right Header Actions */}
      <div className="header-right-actions">
        {onUpdateChapters && (
          <button
            type="button"
            className="header-icon-btn header-chapters-btn"
            onClick={onUpdateChapters}
            disabled={isUpdatingChapters}
            title={
              isUpdatingChapters
                ? t('reader.updatingChapters')
                : t('reader.updateChapters')
            }
            aria-label={t('reader.updateChapters')}
          >
            {isUpdatingChapters ? (
              <Loader2 size={16} className="spinner" />
            ) : (
              <CloudDownload size={16} />
            )}
          </button>
        )}
        {onToggleSettings && (
          <button
            type="button"
            ref={settingsBtnRef}
            className={`header-icon-btn ${isSettingsOpen ? "active" : ""}`}
            onClick={onToggleSettings}
            title={t('reader.appearance')}
            aria-label={t('reader.appearance')}
          >
            <Sliders size={16} />
          </button>
        )}
      </div>
    </header>
  );
};



