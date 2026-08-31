# Folio Reader 📱📖

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tauri: v2](https://img.shields.io/badge/Tauri-v2-24C8D8.svg?logo=tauri&logoColor=white)](https://tauri.app/)
[![React: 19](https://img.shields.io/badge/React-19-61DAFB.svg?logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Rust](https://img.shields.io/badge/Rust-2024%20Edition-orange.svg?logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![Vite](https://img.shields.io/badge/Vite-8.x-646CFF.svg?logo=vite&logoColor=white)](https://vitejs.dev/)

**Folio Reader** is a modern, high-performance, cross-platform e-book reader application designed for desktop (Linux, Windows, macOS) and mobile (Android). Built with **Tauri v2**, **React 19**, and the **Foliate.js** rendering engine, Folio Reader functions both as a standalone local e-book reader and as a client for the [Folio](https://github.com/bastonta/folio) self-hosted digital library ecosystem.

---

## ✨ Key Features

### 📖 Immersive Reading Experience

- **Foliate.js Engine**: High-fidelity EPUB rendering with accurate typography and layout support.
- **Customizable Reader Themes**: Includes `Light`, `Sepia`, `Gray`, `Dark`, and `Solarized` presets.
- **Typography Controls**: Adjustable font family, font size, line spacing, page margins, justification, and hyphenation.
- **Flexible Layouts**: Paginated (single page or two-column spread) and continuous vertical scroll modes.
- **Interactive Navigation**: Interactive Table of Contents (TOC), progress bar scrubber, footnote popups, and reading percentage indicators.
- **Touch & Gesture Support**: Configurable page turning via taps, swipe gestures, or keyboard shortcuts.

### 🖍️ Annotations & Bookmarks

- **Color-Coded Highlights**: Highlight text with multiple color palettes (Yellow, Blue, Green, Red, Purple, Orange, etc.).
- **Rich Notes**: Attach personal notes to highlighted text passages.
- **Location-Aware Bookmarks**: Save precise reading locations (EPUB Canonical Fragment Identifiers / CFI) with chapter and label info.
- **Sidebar Inspector**: Dedicated sidebar tabs to browse, search, jump to, and delete bookmarks and annotations.

### 📚 Library & Catalog Management

- **Local Library**: Recursively scan local folders for e-books with automatic cover extraction, metadata parsing, and caching.
- **Folder Stacks**: Browse books organized in hierarchical folder structures or flat grid/list views.
- **Remote Folio Catalog**: Connect to a remote Folio server to browse, search, and stream-download books for offline reading.
- **Recent Reading Shelf**: Quick access to in-progress books with progress indicators.

### 🔄 Offline-First Synchronization

- **Embedded SQLite Database**: Local reading state, progress, bookmarks, and annotations are stored locally via `sqlx` in an SQLite database.
- **Bi-directional Sync**: Automatically synchronizes reading positions, bookmarks, and annotations with your Folio server backend.
- **Offline Sync Queue**: Read and annotate while offline; changes are automatically queued and synced when connectivity is restored.

### 🔐 Security & Account Management

- **Secure Rust Auth Proxy**: HTTP client proxy with native cookie-jar management for seamless JWT session handling.
- **Full Auth Flow**: Support for Login, User Registration, Email Confirmation, Password Reset, and Two-Factor Authentication (2FA / TOTP).
- **User Profile**: Account management, 2FA setup with QR codes, active session controls, and server health monitoring.

### 📱 Platform-Native Integrations

- **Dynamic Status Bar**: Synchronizes native OS status bar colors with the active reader theme.
- **Hardware Back Button**: Full Android back button navigation stack handling dialogs, modals, and reader views.

---

## 🏗️ Architecture

Folio Reader utilizes Tauri v2 to bridge a modern React 19 frontend with a performant Rust backend runtime:

```text
┌────────────────────────────────────────────────────────┐
│               Frontend (React 19 + TypeScript)         │
│  - Foliate Reader View (EPUB, TOC, Annotations)       │
│  - Local Library & Remote Catalog (BrowseView)         │
│  - Auth & Profile Pages (2FA, Setup, Recovery)         │
│  - State Management & Storage Services                │
└──────────────────────────┬─────────────────────────────┘
                           │ Tauri IPC (invoke / events)
┌──────────────────────────▼─────────────────────────────┐
│                 Rust Core (Tauri v2 + Tokio)           │
│  ├── Auth Proxy (reqwest, cookie store, JWT refresh)   │
│  ├── Local DB (sqlx + SQLite: progress, annotations)   │
│  ├── FS Manager (folder scanning, streaming download) │
│  └── Sync Manager (bi-directional cloud sync)          │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTPS / REST API
┌──────────────────────────▼─────────────────────────────┐
│           Folio Server (Self-Hosted Backend)           │
│          Axum • PostgreSQL • User Progress Sync        │
└────────────────────────────────────────────────────────┘
```

---

## 📂 Project Structure

```text
FolioReader/
├── src/                          # Frontend Application (React 19 + TypeScript)
│   ├── api/                      # REST API client & auth token management
│   │   ├── authApi.ts            # Authentication endpoints & session calls
│   │   ├── client.ts             # Axios / HTTP transport layer
│   │   ├── libraryApi.ts         # Remote library book browsing & download API
│   │   ├── profileApi.ts         # User profile and 2FA management
│   │   └── tokenManager.ts       # Access token lifecycle management
│   ├── components/
│   │   ├── common/               # Reusable UI components (Modals, Settings)
│   │   ├── library/              # LibraryView, BrowseView, FolderStackCover
│   │   └── reader/               # FoliateReader, HeaderBar, Sidebar, TOCView,
│   │                             # AnnotationsView, BookmarksView, Scrubber
│   ├── context/                  # AuthContext and global application states
│   ├── foliate-js/               # Foliate e-book rendering engine modules
│   ├── pages/                    # Route pages (Login, Register, Profile, ServerSetup)
│   ├── services/                 # Local storage, fileManager, readerDb, systemUi
│   ├── styles/                   # Global styles and theme definitions
│   ├── types/                    # TypeScript interfaces (reader, browse, auth)
│   ├── utils/                    # Helper functions (CFI calculations, formatting)
│   ├── App.tsx                   # Main application router and view controller
│   └── main.tsx                  # Application entrypoint
├── src-tauri/                    # Rust Backend (Tauri v2)
│   ├── capabilities/             # Tauri security capabilities & permissions
│   ├── src/
│   │   ├── auth_proxy.rs         # Native HTTP proxy for authenticated requests
│   │   ├── db.rs                 # SQLite schema, migrations, and CRUD operations
│   │   ├── fs_manager.rs         # File system operations & book downloader
│   │   ├── reader_commands.rs    # Tauri command handlers for reader & sync
│   │   ├── sync_manager.rs       # Server synchronization engine
│   │   ├── lib.rs                # Tauri plugin configuration & invoke registry
│   │   └── main.rs               # Rust binary entrypoint
│   ├── Cargo.toml                # Rust crate dependencies and build settings
│   └── tauri.conf.json           # Tauri app configuration & bundle settings
├── package.json                  # Node.js dependencies and scripts
├── tsconfig.json                 # TypeScript compiler configuration
└── vite.config.ts                # Vite build and development server config
```

---

## 🛠️ Tech Stack

### Frontend

- **Framework**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Build Tool**: [Vite](https://vitejs.dev/)
- **Routing**: [React Router v7](https://reactrouter.com/)
- **E-Book Engine**: [Foliate-js](https://github.com/johnfactotum/foliate-js)
- **Icons & UI**: [Lucide React](https://lucide.dev/), [QRCode](https://github.com/soldair/node-qrcode)

### Desktop & Mobile Backend (Rust)

- **Application Framework**: [Tauri v2](https://tauri.app/)
- **Asynchronous Runtime**: [Tokio](https://tokio.rs/)
- **Database**: [SQLx](https://github.com/launchbadge/sqlx) with SQLite
- **Networking**: [Reqwest](https://github.com/seanmonstar/reqwest) (with cookie jar)
- **Serialization**: [Serde](https://serde.rs/) & [serde_json](https://github.com/serde-rs/json)

---

## 🚀 Getting Started

### Prerequisites

Ensure you have the following installed on your machine:

1. **Node.js**: `v20+` and `npm`
2. **Rust**: `1.85+` (`rustup`, `cargo`)
3. **Platform Dependencies**:
   - **Linux**: `libwebkit2gtk-4.1-dev`, `build-essential`, `curl`, `wget`, `file`, `libssl-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`
   - **macOS**: Xcode Command Line Tools
   - **Windows**: Microsoft Visual Studio C++ Build Tools & WebView2
   - **Android (Optional)**: Android Studio, Android SDK (`API 34+`), NDK, and Java JDK 17+

---

### Installation

Clone the repository and install frontend dependencies:

```bash
git clone https://github.com/bastonta/FolioReader.git
cd FolioReader
npm install
```

---

### Development Mode

Run the app in live-reload development mode:

```bash
# Run on Desktop (Linux / macOS / Windows)
npm run tauri dev

# Run on Android Device / Emulator
npm run tauri android dev
```

---

### Building for Production

To create an optimized production build:

```bash
# Build desktop executable / installer (.deb, .AppImage, .msi, .dmg)
npm run tauri build

# Build Android APK / AAB bundle
npm run tauri android build
```

The compiled binaries will be output to `src-tauri/target/release/` or `src-tauri/gen/android/app/build/outputs/apk/`.

---

## ⚙️ Configuration & Server Connection

1. **First Launch**: When launching Folio Reader for the first time, you will be prompted to enter your **Folio Server URL** (e.g. `https://folio.example.com` or `http://192.168.1.100:5144`).
2. **Authentication**: Log in with your Folio account credentials or register a new user.
3. **Download Folder**: Open **Settings** (⚙️) to select your preferred local storage directory for downloaded e-books.
4. **Standalone Mode**: If you don't use a Folio server, you can still open and read any local `.epub` book directly from your filesystem.

---

## 🌐 Folio Ecosystem

Folio Reader is part of the Folio e-book ecosystem:

- **[Folio Server](https://github.com/bastonta/folio)**: Self-hosted e-book library server with metadata processing and multi-user progress sync.
- **[FolioSync KOPlugin](https://github.com/bastonta/FolioSync.koplugin)**: KOReader plugin to sync reading progress and bookmarks from e-ink readers directly to Folio.

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.
