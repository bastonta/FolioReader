import { Library, PanelLeft, Pin, PinOff, Sliders } from "lucide-react";
import React from "react";
import { useTranslation } from "../../i18n";

interface HeaderBarProps {
  onBackToLibrary: () => void;
  onToggleSidebar: () => void;
  isSidebarOpen: boolean;
  onToggleSettings?: () => void;
  isSettingsOpen?: boolean;
  settingsBtnRef?: React.RefObject<HTMLButtonElement | null>;
  onTogglePin?: () => void;
  isPinned?: boolean;
  chapterTitle?: string;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  onBackToLibrary,
  onToggleSidebar,
  isSidebarOpen,
  onToggleSettings,
  isSettingsOpen = false,
  settingsBtnRef,
  onTogglePin,
  isPinned = false,
  chapterTitle,
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

        {/* Sidebar Toggle & Pin Controls */}
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

        {onTogglePin && (
          <button
            type="button"
            className={`header-icon-btn header-pin-btn ${isPinned ? "active" : ""}`}
            onClick={onTogglePin}
            title={isPinned ? t('reader.unpinSidebar') : t('reader.pinSidebar')}
            aria-label={isPinned ? t('reader.unpinSidebar') : t('reader.pinSidebar')}
          >
            {isPinned ? <Pin size={16} /> : <PinOff size={16} />}
          </button>
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



