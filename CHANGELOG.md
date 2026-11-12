# Changelog

All notable changes to the Folio application will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- `BookKind` (`File` | `Chapters`) in library API types (`BookResponseItem`, `BrowseItem`, `BookDetail` with `originBookId` / `chaptersCount`) following the Folio server update that merges BookBot books assembled from chapters.
- Reading books that have no EPUB file on the server yet (`Chapters` kind): the new `download_chapters_book` command downloads the chapters, illustrations and cover and builds a local EPUB that opens, works offline and syncs like any other book. The catalog marks such books with a "Chapters" badge and shows chapter / illustration progress while they are downloaded.
- "Check for new chapters" action for downloaded `Chapters` books: only new and changed chapters are fetched, and the reading position, bookmarks and annotations follow their chapters when the chapter order changes.
- Reading progress of `Chapters` books is exchanged with the server as a chapter reference (`ch:<chapterId>`), the same form the Folio web client uses, so the position carries over between the two.
- Downloading `Chapters` books one volume at a time: for a book with several volumes the catalog offers the whole book or single volumes. Every volume becomes a file of its own (`{name} - Vol 03.epub`, titled `{title} — Том 3`, with series metadata) that can be opened and checked for new chapters independently of the other volumes and of a copy of the whole book. Requires a Folio server that lists volumes (`GET /books/{id}/volumes`); with an older server only the whole book is offered.
- "Get new chapters" button in the reader header for books built from chapters (the whole book or a volume; not shown for books downloaded as EPUB files): it fetches the chapters added on the server and reopens the book at the same place.
- Reading state of a volume copy is exchanged with the server in the scale of the whole book: the position as `ch:<chapterId>`, percentages and reading-session bounds converted between the volume and the book, bookmarks and annotations shifted to the volume's place in the book. Finishing a volume marks the book as read only when it is the last one.
- `db_get_chapter_copies`, `db_get_chapter_copy` and `db_get_chapter_position` commands describing the local copies of a `Chapters` book; `volume` argument of `download_chapters_book`.
- Optional `kind` filter for `browse`, `getBooks` and `getRecentBooks` (all kinds are returned when it is omitted).
- `BookHasNoFileError` and a dedicated `BOOK_HAS_NO_FILE` result from `download_book_file` when the server answers `409 Conflict` for a `Chapters` book; the catalog then falls back to building the book from its chapters.

### Changed
- The catalog lists `Chapters` books alongside `File` books and downloads them chapter by chapter.
- Local copies built from chapters keep their progress, bookmarks, annotations and reading sessions under the id of their own file (`chapter_copies` / `chapter_copy_chapters` tables replace `chapter_book_chapters`, existing data is migrated), so several copies of one server book never read one another's positions. Bookmark and annotation server ids are unique per local book instead of table-wide.
- Deleting a book file from the library keeps the record of what the file was (a copy built from chapters), so changes that were not synced yet are still sent in the scale of the whole book.
- Signing out, an expired session and changing the server no longer delete local data. The local database remembers the account it belongs to and is cleared only when a different account signs in; changes that were not synced yet are sent after the next sign-in.
- Reading progress is exchanged with the server together with the time of the change (`updatedAt`; requires a Folio server that compares it): an older position never replaces a newer one, a background sync never moves the reader, and the reader moves to the server position only when a book is opened or synced by hand.
- Marking a book read or unread no longer invents a reading position; the mark reaches the server through the regular sync (`db_set_read_status` command).
- Books are read from disk in pieces (`get_book_file_size`, `read_book_file_range`) instead of one buffer of the whole file.

### Security
- Scripts inside books are no longer executed: `blob:` is removed from `script-src` of the Content-Security-Policy (`object-src 'none'`, `base-uri 'self'` and `form-action 'none'` are added), and scripts listed in a book's manifest are not loaded. A script in an EPUB could read the access token and call application commands.
- Links in a book or in its description open in the system browser instead of replacing the application window.

### Fixed
- A failed request after a token refresh (a `404` for a book without progress, a `409`, a server error) no longer signs the user out and deletes all local data. The session ends only when the server rejects the refresh token itself.
- A device that comes online with an old reading position no longer overwrites a newer one; a page turned while a sync is in flight is no longer lost; closing or minimising the reader no longer re-sends an unchanged position; page turns made before the first server answer arrives are kept.
- "Mark as unread" is no longer undone by the next sync, and "mark as read" is no longer lost for a whole book built from chapters.
- A downloaded file is matched to a server book by its content, not by its file name: "Volume 1" of one series is no longer bound to "Volume 1" of another, and a download never overwrites the file of a different book (it is saved as `{name} ({id}).epub`).
- A volume copy learns about volumes and chapters added on the server before every sync, so finishing what used to be the last volume no longer marks the whole book as read.
- An expired access token is renewed before commands of the native core use it (sync, downloads, building a book from chapters); a rejected token is reported instead of being taken for a finished sync, and no longer builds a book with missing illustrations.
- Changing the password keeps the session alive (`auth_password_change_proxy` stores the refresh token the server issues with the change).
- Clearing the note of an annotation is saved; creating a bookmark or an annotation is not duplicated when the answer of the server is lost; a deletion applies to the book it was made in only.
- Reading time: the tail of a session is saved when the application goes to the background, activity inside the book counts, and statistics use the time zone of the device.
- Downloads of large files are no longer cut off after two minutes; stale temporary files are removed; control characters in chapter or book titles no longer break a book built from chapters.
- A damaged local database is set aside and recreated instead of crashing the application at every start.
- Opening one book while another is still loading no longer replaces the book being read; out-of-order catalog answers are ignored; both pages of a fixed-layout spread react to touches; arrow keys in the image viewer no longer turn pages; a custom font applies to the first book opened after start; a copy keeps its identity when the download folder changes.

## [0.8.2] - 2026-09-29

### Added
- Dynamic `(Debug)` runtime build indicators in Settings and Profile modals for development environments.
- Loading timeout and fallback recovery mechanisms in Foliate reader and paginator for unresponsive iframes.
- Database migration repairing legacy corrupted reading progress percentages using recent book fractions.
- Unit tests covering reading progress sanitization and session bounds clamping.

### Changed
- Suppressed automatic update checker prompts when running in development mode.
- Refactored command status checks and simplified book path existence resolution.
- Standardized release and versioning workflow across projects without `-dev` suffixes.

### Fixed
- Fixed reading progress percentage sanitization to preserve the [0.0, 100.0] range instead of erroneously dividing values by 100.
- Clamped session start/end progress bounds and filtered NaN values before synchronizing reading sessions with the Folio server.
- Relaxed Content Security Policy (CSP) asset rules (`style-src`) to avoid stylesheet loading and asset modification issues.

## [0.8.1] - 2026-09-27

### Fixed
- Resolved Tauri build failure by pinning native `tauri-plugin-http` crate to `~2.7.0` to match installed `@tauri-apps/plugin-http` NPM package version.
- Updated `uuid` crate dependency to `1.26.1`.

## [0.8.0] - 2026-09-27

### Added
- Location history navigation in reader with Back and Forward buttons in `HeaderBar`.
- Floating `QuickReturnChip` providing quick one-tap return after jumping across locations via footnotes, table of contents, or internal links.
- Previous and Next Chapter step controls in reader `ProgressScrubber`.
- Dedicated Android hardware back button handler (priority 40), desktop keyboard shortcuts (`Alt+Left`, `Alt+Right`, `Ctrl+[`), and mouse back/forward button support for location history.
- Internal and external link navigation support within footnote modal descriptions.
- Enhanced `foliate-js` History class with safe indexing, position getters, and object state resolution.
- React `ErrorBoundary` wrapper in `main.tsx` and `App.tsx` for graceful failure recovery.
- Keyboard navigation (Enter / Space) and accessible focus-visible styling for library book cards and folder items.
- Event broadcasting (`folio:sync-completed`) to automatically refresh `LibraryView` state after background sync finishes.
- Russian and English localization strings for history navigation, chapter stepping, and quick return actions.

### Changed
- Asynchronous reader closing flow: moved session flush and cloud sync to background operations for responsive UI dismiss.
- SQLite connection settings: enabled Write-Ahead Logging (WAL) journal mode, foreign key constraints, and normal synchronous pragma.
- Atomic book downloads: download books into temporary files with atomic rename and automatic cleanup upon failure.
- Streamed file hash computation using `spawn_blocking` to avoid reading entire book files into memory.
- Upgraded frontend and native dependencies: `@tauri-apps/*`, `reqwest`, `react 19`, `vite`, `lucide-react`, and related packages.

### Fixed
- Resolved startup splash screen hang and authentication race condition using a monotonic operation counter and safety timeout.
- Prevented concurrent sync runs and race conditions in `sync_all_pending` using a `SyncLock` state guard.
- Cleaned up reader iframe section event listeners using `AbortController` on section unmount and reload to eliminate memory leaks.
- Added null safety guards and observer cleanup in `Paginator` to prevent runtime exceptions on unmounted elements.
- Validated IPC command arguments and clamped progress percentages within `reader_commands`.

### Security
- Protected authentication refresh tokens in memory using `zeroize::Zeroizing`.
- Configured strict Content Security Policy (CSP) and restricted asset protocol and HTTP capability scopes.
- Sanitized HTML book descriptions using `DOMPurify` in `BookInfoModal` to prevent XSS vulnerabilities.
- Validated custom download directories and file paths against directory traversal attacks.

## [0.7.0] - 2026-09-13

### Added
- Image viewer modal (`ImageViewerModal`) supporting pan, zoom (0.3x–10x), 90° rotation, clipboard copy, and direct image download.
- Multi-image chapter navigation within reader with previous/next image controls and index indicators.
- Contrast mode toggles (white background, dark overlay, invert colors) to preserve visibility of dark illustrations and transparent PNGs on dark reader themes.
- Touch gesture controls for mobile and touchscreens: pinch-to-zoom, pan drag, double-tap to reset/zoom, and tap gesture disambiguation.
- Auto-hide viewer controls with inactivity timer (3.5s) and tap/hover reveal for an unobtrusive full-screen viewing experience.
- Image click and double-click triggers in `FoliateReader` with browser history and hardware back button navigation support.
- Localization strings for image viewer in English and Russian.

## [0.6.1] - 2026-09-04

### Added
- Quick dismiss (close) button on continue reading cards in the Library view.
- "Remove from Continue Reading" action in book context menu.
- English and Russian localization strings for continue reading removal actions.

### Changed
- Automatically remove book from recent books and local SQLite database when resetting reading progress.
- Preserved cached cover files on disk when removing books from the continue reading list.

## [0.6.0] - 2026-09-04

### Added
- Comprehensive book reading statistics in BookInfoModal: total reading time, speed/pace, estimated remaining time, sessions, pages read, first/last read dates, and multi-segment device breakdown.
- Reading statistics reset capability with confirmation dialog across local SQLite database and Folio server.
- Book details and statistics inspection shortcuts in Browse catalog (grid and list views) and Library context menu.
- Folio API client and TypeScript models aligned with OpenAPI 3.1.0 (books, series, bookmarks, annotations, progress, reading summary, daily activity, and system version APIs).
- Email-based confirmation resend support in authentication API with cooldown handling in confirmation and password reset pages.
- Batch downloaded book status checks via SQLite mappings and disk verification (`db_check_downloaded_books`) in BrowseView.
- Localized formatting utilities for reading speed, devices, and dates in Russian and English.

### Changed
- Standardized section page calculations across background measurement and active section relocation in DevicePaginator to prevent page count jumps.
- Debounced SQLite persistence for recent books and reading progress by 800ms with eager flush on reader close, unmount, and background sync.
- Progress scrubber updates visual progress while dragging and triggers reader navigation only upon release (`pointerup`/`touchend`).
- Simplified progress reset to always perform a confirmed reset locally and on the server, removing the device-only option.
- Improved Folio server URL validation with schema verification against `/api/version` and safe protocol handling.

### Fixed
- Prevented infinite sync loops for local-only books by introducing `local_only` sync status and filtering unmapped books from pending sync queues.
- Resolved race conditions between progress pull and background sync when opening a book, deferring progress updates until navigation settles.
- Prevented reading session loss on reader exit by ensuring session persistence completes before triggering sync and unmounting.
- Fixed annotation editing and deletion by preserving IDs/metadata, cleaning up duplicate entries matching CFI or ID, and preventing duplicate bookmarks/annotations.
- Synchronized remote deletions for bookmarks and annotations, pruning local synced records and updating active reader overlays.
- Prevented terminal window popup/flash on Windows when opening external URLs and folders by prioritizing native shell execution with `CREATE_NO_WINDOW`.
- Prevented scrubber jumps and programmatic sync navigations from artificially inflating reading tracker page counts.
- Cached missing cover status (`no_cover`) to avoid repeated extraction attempts, and added SQLite fallback to resolve book file paths.
- Cleaned up blob object URLs on reader unmount and cancellation in FoliateReader.

### Security
- Sanitized footnote HTML content in FootnoteModal using DOMPurify to prevent XSS vulnerabilities.

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
