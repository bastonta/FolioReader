# Folio Reader — Project Rules & Guidelines

Welcome to **Folio Reader**, a modern, high-performance, cross-platform e-book reader application designed for desktop (Linux, Windows, macOS) and mobile (Android). Built with **Tauri v2**, **React 19**, **TypeScript**, and a native **Rust runtime**, Folio Reader operates both as a standalone local reader and as an offline-first companion client for the [Folio](https://github.com/bastonta/folio) digital library ecosystem.

This document serves as the single source of truth for architecture, coding conventions, and operational rules for both human developers and AI assistants working in this repository.

---

## 1. Project Architecture & Workspace Layout

Folio Reader combines a React 19 SPA frontend with a multi-threaded Rust core managed through Tauri v2 IPC:

```text
FolioReader/
├── src/                          # Frontend Application (React 19 + TypeScript + Vite)
│   ├── api/                      # Remote Folio REST client & token lifecycle
│   │   ├── authApi.ts            # Login, 2FA, session verify, token refresh
│   │   ├── client.ts             # HTTP transport & header handling
│   │   ├── libraryApi.ts         # Remote library catalog & book download API
│   │   ├── profileApi.ts         # User profile and 2FA settings
│   │   └── tokenManager.ts       # In-memory access token cache
│   ├── components/               # React UI Components
│   │   ├── common/               # Modals, settings dialogs, theme switches
│   │   ├── library/              # LibraryView, BrowseView, FolderStackCover, BookCard
│   │   └── reader/               # FoliateReader, FootnoteModal, ReaderControls, ReaderSidebar
│   ├── context/                  # Application React contexts (Auth, Settings, Theme)
│   ├── foliate-js/               # Vendored Foliate.js reading engine (EPUB, MOBI, PDF, CBZ)
│   ├── services/                 # Frontend bridge services (dbService, syncService, storageService)
│   ├── types/                    # Shared TypeScript interfaces (books, annotations, progress, IPC)
│   └── utils/                    # Formatting, file size, gesture, and debounce utilities
├── src-tauri/                    # Native Rust Core (Tauri v2 + Tokio + SQLite)
│   ├── Cargo.toml                # Rust dependencies & release profile optimizations
│   └── src/
│       ├── lib.rs                # Tauri plugin registrations, app data dir resolution, invoke handlers
│       ├── main.rs               # Executable desktop entrypoint
│       ├── auth_proxy.rs         # Reqwest client with native cookie-jar for resilient auth sessions
│       ├── db.rs                 # Embedded SQLite (sqlx) schema, migrations, and local CRUD
│       ├── fs_manager.rs         # Local book scanning, streaming downloads, custom font management
│       ├── reader_commands.rs    # Tauri IPC invoke commands bridging frontend to SQLite & Sync
│       └── sync_manager.rs       # Bi-directional cloud sync engine, conflict resolution & offline queue
├── package.json                  # Node dependencies & frontend scripts
├── vite.config.ts                # Vite bundler configuration
└── tsconfig.json                 # TypeScript compiler configuration
```

---

## 2. Core Architectural & Synchronization Principles

### A. Offline-First Synchronization

- **Local SQLite as Immediate Source of Truth**: Every user action (reading position updates, bookmarks, highlights, and notes) is written immediately to the local SQLite database (`folio_local.db`) via `db.rs`.
- **Background Sync Queue**:
  - When the device is online, changes are debounced and synchronized bi-directionally with the Folio server.
  - When offline or disconnected, modifications are flagged in the local database and processed automatically once connectivity is restored (`sync_all_pending`).
  - When pulling progress from the server, the client resolves conflicts by comparing timestamps (`updated_at`).

### B. Secure Rust Auth Proxy (`auth_proxy.rs`)

- Standard WebViews (especially on Android) have strict cross-origin cookie restrictions and ephemeral storage.
- Authentication requests (login, 2FA, token refresh, and logout) are routed through the native Rust `AuthHttpClient` which maintains a persistent in-memory cookie jar and passes Bearer access tokens to the frontend.

### C. Reading Engine & Location Precision (`foliate-js`)

- EPUB rendering is powered by `foliate-js`.
- Reading progress and bookmarks are tracked using **EPUB Canonical Fragment Identifiers (CFI)** (e.g. `epubcfi(/6/8!/4/2/1:0)`).
- When communicating with the Folio server, positions are submitted with format negotiation (CFI or CFL) to ensure cross-device consistency with KOReader (`FolioSync`).

### D. Platform-Native Integrations

- **Android Navigation**: Uses hardware back button handlers (`useBackButton`) to dismiss modals, drawers, and reader views before allowing the app to background.
- **Dynamic Status Bar**: Updates system UI colors on mobile to match the active reader theme (`Light`, `Sepia`, `Gray`, `Dark`, `Solarized`).
- **Storage Paths**: Base directories are dynamically resolved using `get_app_base_dir()` (`app_local_data_dir()` or `dev_data/` in development).

---

## 3. Essential CLI Commands

Run commands from the repository root:

### Frontend (React & TypeScript)

```bash
# Install frontend dependencies
npm install

# Start Vite dev server for browser preview
npm run dev

# Typecheck and build the production bundle
npm run build
```

### Tauri Desktop (Linux, Windows, macOS)

```bash
# Run desktop development application
npm run tauri:dev

# Build release desktop bundle (deb, rpm, AppImage, msi, dmg)
npm run tauri build
```

### Tauri Mobile (Android)

```bash
# Run Android app on connected device / emulator
npm run tauri:android:dev

# Build Android release APK (aarch64)
npm run tauri:android:build:dev
```

### Rust Core (`src-tauri`)

```bash
# Fast check of the Tauri Rust core
cargo check --manifest-path src-tauri/Cargo.toml

# Lint Rust code with Clippy
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets

# Format Rust code
cargo fmt --manifest-path src-tauri/Cargo.toml

# Run Rust unit tests (SQLite CRUD, sync queue, book checks)
cargo test --manifest-path src-tauri/Cargo.toml
```

---

## 4. Coding Conventions & Best Practices

### A. TypeScript & React

- **Strict Type Safety**: Do not use `any`. Always define explicit interfaces in `src/types/` for data models and Tauri IPC payloads.
- **IPC Invocations**: Encapsulate all `invoke(...)` calls in `src/services/` or `src/api/` rather than calling `invoke` raw inside UI components.
- **Debounced Updates**: Debounce rapid reader events (page turns, scrubber drag, resize) before dispatching SQLite or network updates.
- **Sanitize HTML**: Always sanitize user notes, HTML book descriptions, and footnote contents using `DOMPurify` before injecting with `dangerouslySetInnerHTML`.

### B. Rust Core (`src-tauri/src/`)

- **Error Resilience**: Never use `unwrap()` or `expect()` inside IPC command handlers. Return `Result<T, String>` so that errors are passed gracefully as rejected Promises to the frontend.
- **Database Migrations**: SQLite schema changes in `db.rs` must include migration steps (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN ...` with existence checks).
- **Asynchronous Execution**: Perform all file I/O, network requests, and database queries asynchronously via `tokio`.

---

## 5. AI Assistant Operating Guidelines

When modifying code in this repository:

1. **Dual-Stack Verification**: Any modification that affects IPC contracts or data structures requires verifying both sides:
   - Run `npm run build` to verify TypeScript types and JSX compilation.
   - Run `cargo check --manifest-path src-tauri/Cargo.toml` to verify Rust code.
   - Run `cargo test --manifest-path src-tauri/Cargo.toml` if modifying `db.rs` or `sync_manager.rs`.
2. **Preserve Offline Capability**: Never write code that assumes network connectivity is guaranteed. The reader must always remain functional offline.
3. **Preserve Documentation Integrity**: Do not remove existing code comments, docstrings, or test cases unless directly replaced by updated architectural patterns.
4. **Git Commit Style**: Use Conventional Commits with appropriate scopes:
   - `feat(reader): ...`, `fix(sync): ...`, `feat(library): ...`, `fix(auth): ...`, `chore(release): ...`.
5. **Releases & Versioning**: Follow Keep a Changelog in `CHANGELOG.md` and use the `.agents/skills/changelog-release-tag` skill when bumping versions and cutting tags (`vX.Y.Z`).
