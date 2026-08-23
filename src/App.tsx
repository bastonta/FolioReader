import { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { FoliateReader } from './components/reader/FoliateReader';
import { LibraryView } from './components/library/LibraryView';
import { BrowseView } from './components/library/BrowseView';
import { SettingsModal } from './components/common/SettingsModal';
import { ReaderSettings } from './types/reader';
import { LocalBookFile } from './types/browse';
import {
  loadSettings,
  saveSettings,
  formatLanguageMap,
  formatContributor,
  storeBookCover,
  blobToThumbnailDataUrl,
  saveLocalBookCache,
  saveRecentBook,
} from './services/storage';
import { saveDbBookMapping, loadDbLastLocation } from './services/readerDb';
import { fileManager } from './services/fileManager';
import { setStatusBarVisible, setStatusBarTheme, isMobileDevice } from './services/systemUi';
import { useBackHandler } from './services/backHandler';
import { SplashScreen } from './components/common/SplashScreen';
import { AuthProvider, useAuth } from './context/AuthContext';

// Auth pages
import { ServerSetup } from './pages/ServerSetup';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ConfirmEmailPage } from './pages/ConfirmEmailPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ProfilePage } from './pages/ProfilePage';

import './styles/auth.css';
import './App.css';

// ─── Active book state ───────────────────────────────────────────────────

interface ActiveBookState {
  id: string;
  source: File | Blob | string;
  title?: string;
  author?: string;
}

// ─── Route guard: requires authentication ────────────────────────────────

function RequireAuth({ children, theme }: { children: React.ReactNode; theme?: string }) {
  const { isAuthenticated, isLoading, serverUrl } = useAuth();

  if (isLoading) {
    return <SplashScreen theme={theme} />;
  }

  if (!serverUrl) {
    return <Navigate to="/server" replace />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// ─── Route guard: redirect if already authenticated ──────────────────────

function GuestOnly({ children, theme }: { children: React.ReactNode; theme?: string }) {
  const { isAuthenticated, isLoading, serverUrl } = useAuth();

  if (isLoading) {
    return <SplashScreen theme={theme} />;
  }

  if (!serverUrl) {
    return <Navigate to="/server" replace />;
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

// ─── Main app with routes ────────────────────────────────────────────────

function AppRoutes() {
  const { isAuthenticated, isLoading } = useAuth();
  const [settings, setSettings] = useState<ReaderSettings>(() => loadSettings());
  const [activeBook, setActiveBook] = useState<ActiveBookState | null>(null);
  const [currentView, setCurrentView] = useState<'library' | 'browse'>('library');
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Reset active book and reload settings when auth state changes (e.g. login/logout)
  useEffect(() => {
    if (!isAuthenticated) {
      setActiveBook(null);
      setSettings(loadSettings());
    }
  }, [isAuthenticated]);

  // Handle back button for Settings Modal
  useBackHandler(
    () => {
      setIsSettingsModalOpen(false);
      return true;
    },
    isSettingsModalOpen,
    100
  );

  // Handle back button for non-root routes (e.g., /profile, /register, /forgot-password, /confirm-email)
  useBackHandler(
    () => {
      if (location.pathname === '/profile') {
        navigate('/', { replace: true });
        return true;
      }
      if (
        location.pathname === '/register' ||
        location.pathname === '/forgot-password' ||
        location.pathname === '/confirm-email'
      ) {
        navigate('/login', { replace: true });
        return true;
      }
      navigate(-1);
      return true;
    },
    location.pathname !== '/' && location.pathname !== '/login' && location.pathname !== '/server',
    10
  );

  // Initialize default download directory if not configured
  useEffect(() => {
    async function initDownloadDir() {
      if (!settings.downloadPath) {
        const defaultDir = await fileManager.getDefaultDownloadDir();
        if (defaultDir) {
          const updated = saveSettings({ downloadPath: defaultDir });
          setSettings(updated);
        }
      }
    }
    initDownloadDir();
  }, [settings.downloadPath]);

  // Synchronize native status bar icon appearance with the current app theme
  useEffect(() => {
    setStatusBarTheme(settings.theme);
  }, [settings.theme]);

  // Sync settings updates
  const handleUpdateSettings = (newSettings: Partial<ReaderSettings>) => {
    if (newSettings.theme) {
      setStatusBarTheme(newSettings.theme);
    }
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      saveSettings(updated);
      return updated;
    });
  };

  // Open a local book file in FoliateReader
  const handleOpenLocalBook = async (
    book: LocalBookFile,
    cachedMeta?: { title?: string; author?: string; coverUrl?: string; extracted?: boolean }
  ) => {
    try {
      if (!settings.sidebarPinned || isMobileDevice()) {
        handleUpdateSettings({ sidebarOpen: false });
      }
      const filePath = book.filePath;
      const fileName = book.fileName;
      const file = await fileManager.readBookFile(filePath);

      let title = cachedMeta?.title || fileName.replace(/\.[^/.]+$/, '');
      let author = cachedMeta?.author || 'Unknown Author';

      // If not cached or previously incomplete, extract metadata eagerly
      if (!cachedMeta?.title || !cachedMeta?.extracted || (cachedMeta?.author === 'Unknown Author' && !cachedMeta?.coverUrl)) {
        try {
          const { makeBook } = await import('./foliate-js/view.js');
          const parsedBook: any = await makeBook(file);
          if (parsedBook) {
            if (parsedBook.metadata?.title) {
              title = formatLanguageMap(parsedBook.metadata.title) || title;
            }
            if (parsedBook.metadata?.author || parsedBook.metadata?.creator) {
              author = formatContributor(parsedBook.metadata.author || parsedBook.metadata.creator) || author;
            }
            let coverUrl: string | undefined;
            if (parsedBook.getCover) {
              const coverBlob = await Promise.resolve(parsedBook.getCover());
              if (coverBlob) {
                await storeBookCover(book.id, coverBlob);
                coverUrl = await blobToThumbnailDataUrl(coverBlob);
              }
            }
            saveLocalBookCache(book.id, { title, author, coverUrl, extracted: true });
            parsedBook.destroy?.();
          }
        } catch (e) {
          console.warn('Metadata extraction skipped or failed:', e);
        }
      }

      saveDbBookMapping(book.id, '', filePath).catch(console.warn);

      const lastLoc = await loadDbLastLocation(book.id);
      saveRecentBook({
        id: book.id,
        title,
        author,
        coverUrl: cachedMeta?.coverUrl,
        filePath,
        progressFraction: lastLoc?.fraction || 0,
        lastOpenedAt: new Date().toISOString(),
        fileName,
        fileSize: book.fileSize,
      });

      setActiveBook({
        id: book.id,
        source: file,
        title,
        author,
      });
    } catch (err) {
      console.error('Failed to open local book file:', err);
      alert('Failed to open book file.');
    }
  };

  // Open book from file path directly (e.g. from BrowseView after downloading)
  const handleOpenBookFromPath = async (
    filePath: string,
    title?: string,
    author?: string,
    serverBookId?: string
  ) => {
    try {
      if (!settings.sidebarPinned || isMobileDevice()) {
        handleUpdateSettings({ sidebarOpen: false });
      }
      const file = await fileManager.readBookFile(filePath);
      const fileName = filePath.split(/[\\/]/).pop() || 'book.epub';
      const bookId = `local-${filePath.replace(/[^a-zA-Z0-9]/g, '_')}`;

      if (serverBookId) {
        saveDbBookMapping(bookId, serverBookId, filePath).catch(console.warn);
      }

      const lastLoc = await loadDbLastLocation(bookId);
      saveRecentBook({
        id: bookId,
        title: title || fileName.replace(/\.[^/.]+$/, ''),
        author: author || 'Unknown Author',
        filePath,
        progressFraction: lastLoc?.fraction || 0,
        lastOpenedAt: new Date().toISOString(),
        fileName,
      });

      setActiveBook({
        id: bookId,
        source: file,
        title: title || fileName.replace(/\.[^/.]+$/, ''),
        author: author || 'Unknown Author',
      });
    } catch (err) {
      console.error('Failed to open book from path:', err);
      alert('Failed to open downloaded book file.');
    }
  };

  // Back to Library
  const handleBackToLibrary = () => {
    setStatusBarVisible(true);
    setStatusBarTheme(settings.theme);
    if (!settings.sidebarPinned || isMobileDevice()) {
      handleUpdateSettings({ sidebarOpen: false });
    }
    setActiveBook(null);
    document.title = 'Folio — E-Book Reader';
  };

  // Navigate to profile
  const handleOpenProfile = () => {
    navigate('/profile');
  };

  const handleToggleAuthTheme = () => {
    handleUpdateSettings({ theme: settings.theme === 'dark' || settings.theme === 'gray' ? 'light' : 'dark' });
  };

  if (isLoading) {
    return <SplashScreen theme={settings.theme} />;
  }

  return (
    <div className={`app-container theme-${settings.theme}`}>
      <Routes>
        {/* ── Public auth routes ─────────────────────────────── */}
        <Route path="/server" element={<ServerSetup theme={settings.theme} onToggleTheme={handleToggleAuthTheme} />} />
        <Route
          path="/login"
          element={
            <GuestOnly theme={settings.theme}>
              <LoginPage theme={settings.theme} onToggleTheme={handleToggleAuthTheme} />
            </GuestOnly>
          }
        />
        <Route
          path="/register"
          element={
            <GuestOnly theme={settings.theme}>
              <RegisterPage theme={settings.theme} onToggleTheme={handleToggleAuthTheme} />
            </GuestOnly>
          }
        />
        <Route
          path="/confirm-email"
          element={<ConfirmEmailPage theme={settings.theme} onToggleTheme={handleToggleAuthTheme} />}
        />
        <Route
          path="/forgot-password"
          element={
            <GuestOnly theme={settings.theme}>
              <ForgotPasswordPage theme={settings.theme} onToggleTheme={handleToggleAuthTheme} />
            </GuestOnly>
          }
        />

        {/* ── Protected routes ───────────────────────────────── */}
        <Route
          path="/profile"
          element={
            <RequireAuth theme={settings.theme}>
              <ProfilePage />
            </RequireAuth>
          }
        />
        <Route
          path="/"
          element={
            <RequireAuth theme={settings.theme}>
              {activeBook ? (
                <FoliateReader
                  bookId={activeBook.id}
                  bookSource={activeBook.source}
                  settings={settings}
                  onUpdateSettings={handleUpdateSettings}
                  onBackToLibrary={handleBackToLibrary}
                />
              ) : currentView === 'browse' ? (
                <BrowseView
                  settings={settings}
                  onBackToLocalLibrary={() => setCurrentView('library')}
                  onOpenBookFromPath={handleOpenBookFromPath}
                  onUpdateSettings={handleUpdateSettings}
                />
              ) : (
                <LibraryView
                  settings={settings}
                  onOpenLocalBook={handleOpenLocalBook}
                  onOpenBrowse={() => setCurrentView('browse')}
                  onOpenSettings={() => setIsSettingsModalOpen(true)}
                  onOpenProfile={handleOpenProfile}
                  onUpdateSettings={handleUpdateSettings}
                />
              )}
            </RequireAuth>
          }
        />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* App Settings Modal */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        settings={settings}
        onUpdateSettings={handleUpdateSettings}
      />
    </div>
  );
}

// ─── Root component ──────────────────────────────────────────────────────

export function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

export default App;
