# Changelog

All notable changes to the Folio application will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.5.0] - 2026-09-01

### Added
- Reading progress background synchronization when the app is minimized or the screen turns off (`visibilitychange`).
- Periodic reading progress sync (60-second interval) when pages have been turned during a reading session.
- Automatic missing book cover verification and recovery via EPUB cover extraction and server fallback on library refresh or image loading error.
- Dedicated `bookMetaExtractor` service for client-side metadata and cover extraction from local EPUB files.
- Clear search button in the browse catalog search bar.

### Changed
- Updated package dependencies to latest versions.

### Fixed
- Fixed grid and list view mode toggle button overflow and enabled responsive shrinking for filter and sort controls on mobile screens in BrowseView.
- Validated physical file existence of book covers on disk in SQLite database queries and storage cache to prevent 404 errors.
- Immediately persist cover URLs when downloading books from server catalog.

## [0.4.0] - 2026-08-31

### Added
- Reading progress display mode settings (`pages`, `chapter_ttr`, `book_ttr`, `percent`) with session persistence and live footer synchronization.
- Localized time formatting service (`timeFormat`) supporting readable duration strings in English and Russian across reader scrubber and book info modals.
- Top and bottom gesture deadzones for tap and swipe navigation in the reader with safe-area insets support to prevent accidental page flips.
- Distinct emerald-badged development build icons for desktop, Android, and web platforms to differentiate debug builds.

### Changed
- Renamed project from FolioApp to FolioReader across package names, Rust crate/binary identifiers, Android namespace (`com.folio.folioreader`), and repository links.

## [0.3.0] - 2026-08-30

### Added
- Reading session tracking with automatic sync to Folio server, including Time-to-Read estimations for books and individual chapters.
- Device screen pagination displaying current page and total pages for the whole book and per chapter.

### Changed
- Upgraded dependencies to latest versions: Tauri packages (@tauri-apps/api, opener, cli), React 19.2.x, Vite 8.2.2, plugin-react 6.1.1, lucide-react, and react-router-dom.

### Fixed
- Resolved reading statistics tracking and sync issues with session data persistence.

## [0.2.6] - 2026-08-29

### Added
- Window state persistence support for desktop platforms (remembers window size, position, and maximized state across restarts).
- Configured minimum window dimensions (600x600) and initial hidden window visibility in Tauri configurations to prevent startup flicker during state restoration.

### Changed
- Refactored `fs_manager` process status checks and cleaned up unused variable warnings on non-Linux platforms.
- Updated `uuid` dependency to `1.26.0`.

## [0.2.5] - 2026-08-29

### Added
- Native overscroll containment and hardware scrolling on scrollable containers.
- Support for dev/release default storage folder paths (Downloads for dev, Documents for release).
- Added `CHANGELOG.md` and automated release notes extraction for GitHub Actions releases.

### Changed
- Refactored reader header bar to remove duplicate sidebar pin button.

### Fixed
- Fixed Android folder picker getting stuck in selecting state when cancelled.
- Polished native app experience: eliminated default browser focus outlines, removed web tap highlights, and styled text selection.

## [0.2.4] - 2026-08-29

### Fixed

- Fixed valid `Productivity` bundle category in `tauri.conf.json`.
- Fixed opening external links, font folder, and update downloads in Linux AppImage with DBus portal and environment sanitization.

### Added

- Configured Linux desktop entry template with localized English and Russian metadata.

## [0.2.3] - 2026-08-28

### Added

- Use reading progress from Folio server book detail endpoint when downloading books.
- Save existing reading progress and completion status to SQLite `book_progress` table on download.
- Added `updatedAt` field to progress info and sync triggers.
- Added solarized theme support and use theme for splash screen.

### Fixed

- Purged deleted books from continue reading shelf and restored folder stacked covers layout.
- Fixed book cover loading on Linux and improved placeholder fallbacks.
- Disabled default browser context menu in production builds.

## [0.2.2] - 2026-08-27

### Fixed

- Fixed `TypeError` in `BookInfoModal` when book metadata subjects are object/contributor structures.
- Added robust formatters for language maps, contributors, and subjects in storage service.
- Added safe optional chaining during foliate paginator and view destruction on unmount.

## [0.2.1] - 2026-08-27

### Added

- Migrated book covers from `localStorage` base64 strings to disk files (`covers/{id}.jpg`).
- Migrated reader settings to `settings.json` with lightweight theme preload mirror in `localStorage`.
- Stored local books metadata, recent books history, and app KV data in SQLite (`folio_local.db`).
- Enabled Tauri 2 `protocol-asset` feature and configured asset protocol security scope.
- Enhanced EPUB cover extraction to handle guide XHTML pages, manifest keywords, and fallback images.

### Removed

- Removed legacy IndexedDB layer and purged oversized localStorage keys on startup.

### Fixed

- Bypass update check for development and debug builds.
- Made update check button compact to match settings UI style.

## [0.2.0] - 2026-08-27

### Added

- Implemented `updateChecker` service querying GitHub Releases API with SemVer comparison.
- Added platform-specific download asset detection (APK, Windows/Linux/macOS binaries).
- Created `UpdateModal` dialog displaying release notes, version diff, and download links.
- Added manual update check button and configuration toggles in `SettingsModal` and `ProfilePage`.
- Added silent background auto-check on startup in `App`.
- Added custom cross-platform modal system (`DialogContext`, `DialogProvider`, `useDialog` hook) replacing native alerts/confirms.
- Added unified cross-platform `Select` component with portal rendering and theme styling.
- Added full Russian and English localization (`i18n`) for all UI.
- Added Android volume button page navigation and screen timeout settings.
- Added isolated configuration, database, and storage for dev/debug builds (`.dev` suffix).

### Fixed

- Fixed folder grid card layout alignment and blank spacing.

## [0.1.2] - 2026-08-26

### Added

- Added book context menu with 'Mark as read/unread', 'Reset progress', and 'Delete' actions.
- Added `ResetProgressModal` supporting local-only or server & device progress reset.
- Implemented `db_delete_progress` Tauri command and SQLite handler for progress cleanup.
- Added `setBookReadStatus` and `resetBookProgress` services with server sync.
- Customized Windows installer settings and product name in Tauri config.

### Fixed

- Improved form tab navigation order and disabled sidebar pin by default.
- Configured input autocomplete attributes to disable unwanted browser autofill history.

## [0.1.1] - 2026-08-25

### Fixed

- Added disk cleanup step in CI release workflow to prevent runner out-of-space errors during Android multi-target compilation.

## [0.1.0] - 2026-08-25

### Added

- Initial public release of FolioReader cross-platform e-reader.
- Cross-platform EPUB reader powered by foliate-js and Tauri 2 (Windows, Linux, Android).
- Local library management with folder support and automatic cover extraction.
- Folio Server authentication, session persistence, 2FA setup, and book catalog browsing.
- Distraction-free immersive reading mode, dynamic status bar theming, and footnote popups.
- Customizable typography, themes (Light, Sepia, Gray distortion, Dark), margins, and alignment.
- Text annotations, highlight colors, bookmarks, and table of contents.
- Multi-platform GitHub Actions release workflow for Windows, Linux, and Android.
