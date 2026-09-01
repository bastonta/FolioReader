import {
  ArrowLeft,
  ArrowUpDown,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Download,
  Filter,
  Folder,
  Home,
  LayoutGrid,
  List as ListIcon,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  WifiOff,
  X,
} from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import { BrowseParams, libraryApi } from "../../api/libraryApi";
import { Select } from "../common/Select";
import {
  getAccessToken,
  getServerUrl,
  isNetworkError,
} from "../../api/tokenManager";
import { useAuth } from "../../context/AuthContext";
import { useDialog } from "../../context/DialogContext";
import { useTranslation } from "../../i18n";
import { useBackHandler } from "../../services/backHandler";
import { fileManager } from "../../services/fileManager";
import { saveDbBookMapping } from "../../services/readerDb";
import {
  saveRecentBook,
  saveLastLocation,
  saveLocalBookCache,
} from "../../services/storage";
import { convertFileSrc } from "@tauri-apps/api/core";
import { BrowseItem, BookDetail } from "../../types/browse";
import { ReaderSettings } from "../../types/reader";

interface BrowseViewProps {
  settings: ReaderSettings;
  onBackToLocalLibrary: () => void;
  onOpenBookFromPath?: (
    filePath: string,
    title?: string,
    author?: string,
    serverBookId?: string,
  ) => void;
  onBookDownloaded?: () => void;
  onUpdateSettings?: (settings: Partial<ReaderSettings>) => void;
}

export const BrowseView: React.FC<BrowseViewProps> = ({
  settings,
  onBackToLocalLibrary,
  onOpenBookFromPath,
  onBookDownloaded,
  onUpdateSettings,
}) => {
  const { t } = useTranslation();
  const { alert } = useDialog();
  const { isOffline, checkOnlineStatus } = useAuth();
  // Navigation & Folder path
  const [currentSeriesPath, setCurrentSeriesPath] = useState<
    Array<{ id: string; name: string }>
  >([]);

  // View mode: 'grid' | 'list'
  const [viewMode, setViewMode] = useState<"grid" | "list">(() => {
    return settings.libraryViewMode || "grid";
  });

  useEffect(() => {
    if (settings.libraryViewMode && settings.libraryViewMode !== viewMode) {
      setViewMode(settings.libraryViewMode);
    }
  }, [settings.libraryViewMode]);

  const handleToggleViewMode = (mode: "grid" | "list") => {
    setViewMode(mode);
    onUpdateSettings?.({ libraryViewMode: mode });
  };

  // Search, Filter & Sort
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [searchBy, setSearchBy] = useState<
    "all" | "title" | "author" | "series"
  >("all");
  const [sortBy, setSortBy] = useState<"name" | "recent" | "sortOrder">("name");
  const [page, setPage] = useState(1);
  const limit = 20;

  // Back button handling in BrowseView (highest to lowest priority)
  useBackHandler(
    () => {
      setCurrentSeriesPath((prev) => prev.slice(0, -1));
      return true;
    },
    currentSeriesPath.length > 0,
    50,
  );
  useBackHandler(
    () => {
      setSearch("");
      setSearchInput("");
      return true;
    },
    Boolean(search || searchInput),
    40,
  );
  useBackHandler(
    () => {
      onBackToLocalLibrary();
      return true;
    },
    true,
    20,
  );

  // Data & loading states
  const [items, setItems] = useState<BrowseItem[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Download states: bookId -> 'downloading' | 'downloaded' | 'error'
  const [downloadStates, setDownloadStates] = useState<
    Record<string, "downloading" | "downloaded" | "error">
  >({});
  const [downloadedPaths, setDownloadedPaths] = useState<
    Record<string, string>
  >({});

  const seriesMapRef = React.useRef<Map<string, any> | null>(null);

  const getSeriesMap = useCallback(async (): Promise<Map<string, any>> => {
    if (seriesMapRef.current) return seriesMapRef.current;
    try {
      const list = await libraryApi.getSeries();
      const map = new Map<string, any>();
      for (const item of list) {
        map.set(item.id, item);
      }
      seriesMapRef.current = map;
      return map;
    } catch (err) {
      console.warn("Failed to load series list:", err);
      return new Map();
    }
  }, []);

  const resolveBookSeriesPath = useCallback(
    async (
      bookId: string,
      activeBreadcrumb: Array<{ id: string; name: string }>,
      bookDetailParam?: BookDetail | null,
    ): Promise<string | undefined> => {
      if (settings.createSeriesFolder === false) {
        return undefined;
      }

      const currentBreadcrumbNames = activeBreadcrumb.map((s) => s.name);

      try {
        const [bookDetail, seriesMap] = await Promise.all([
          bookDetailParam !== undefined
            ? Promise.resolve(bookDetailParam)
            : libraryApi.getBook(bookId, 'cfi').catch(() => null),
          getSeriesMap(),
        ]);

        if (
          !bookDetail ||
          !bookDetail.series ||
          bookDetail.series.length === 0
        ) {
          return currentBreadcrumbNames.length > 0
            ? currentBreadcrumbNames.join("/")
            : undefined;
        }

        // Helper: trace ancestor chain from series ID
        const getAncestorPath = (seriesId: string): string[] => {
          const path: string[] = [];
          let currId: string | null | undefined = seriesId;
          const visited = new Set<string>();

          while (currId && !visited.has(currId)) {
            visited.add(currId);
            const s = seriesMap.get(currId);
            if (!s) {
              const inBook = bookDetail.series.find((bs) => bs.id === currId);
              if (inBook) {
                path.unshift(inBook.name);
                currId = inBook.parentId;
                continue;
              }
              break;
            }
            path.unshift(s.name);
            currId = s.parentId;
          }
          return path;
        };

        const candidatePaths: string[][] = [];
        for (const s of bookDetail.series) {
          const p = getAncestorPath(s.id);
          if (p.length > 0) {
            candidatePaths.push(p);
          } else if (s.name) {
            candidatePaths.push([s.name]);
          }
        }

        if (candidatePaths.length === 0) {
          return currentBreadcrumbNames.length > 0
            ? currentBreadcrumbNames.join("/")
            : undefined;
        }

        // If currently inside a folder, find candidate path that matches active folder
        if (activeBreadcrumb.length > 0) {
          const activeName = activeBreadcrumb[activeBreadcrumb.length - 1].name;
          const matching = candidatePaths.find((p) => p.includes(activeName));
          if (matching) {
            return matching.join("/");
          }
        }

        // Otherwise pick the longest / most specific hierarchy path
        candidatePaths.sort((a, b) => b.length - a.length);
        return candidatePaths[0].join("/");
      } catch (e) {
        console.warn("Failed to resolve book series path:", e);
        return currentBreadcrumbNames.length > 0
          ? currentBreadcrumbNames.join("/")
          : undefined;
      }
    },
    [settings.createSeriesFolder, getSeriesMap],
  );

  const currentSeriesId =
    currentSeriesPath.length > 0
      ? currentSeriesPath[currentSeriesPath.length - 1].id
      : undefined;

  // Fetch browse items
  const fetchBrowseItems = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params: BrowseParams = {
        seriesId: currentSeriesId,
        search: search.trim() || undefined,
        searchBy,
        sortBy,
        offset: (page - 1) * limit,
        limit,
      };

      const res = await libraryApi.browse(params);
      setItems(res.items || []);
      setTotalItems(res.total || 0);

      // Check which books are already downloaded locally
      if (settings.downloadPath && res.items) {
        const bookItems = res.items.filter((i) => i.type === "book");
        const newPaths: Record<string, string> = {};
        const newStates: Record<
          string,
          "downloading" | "downloaded" | "error"
        > = {};
        for (const book of bookItems) {
          const seriesPath =
            currentSeriesPath.map((s) => s.name).join("/") || undefined;
          const fileName = `${book.name}.epub`;
          const existingPath = await fileManager.checkBookDownloaded({
            baseDir: settings.downloadPath,
            fileName,
            seriesName:
              settings.createSeriesFolder !== false ? seriesPath : undefined,
          });
          if (existingPath) {
            newPaths[book.id] = existingPath;
            newStates[book.id] = "downloaded";
          }
        }
        if (Object.keys(newPaths).length > 0) {
          setDownloadedPaths((prev) => ({ ...prev, ...newPaths }));
          setDownloadStates((prev) => ({ ...prev, ...newStates }));
        }
      }
    } catch (err: any) {
      console.error("Failed to browse library:", err);
      setError(err?.message || "Failed to load catalog from server");
    } finally {
      setIsLoading(false);
    }
  }, [
    currentSeriesId,
    currentSeriesPath,
    search,
    searchBy,
    sortBy,
    page,
    settings.downloadPath,
    settings.createSeriesFolder,
  ]);

  useEffect(() => {
    fetchBrowseItems();
  }, [fetchBrowseItems]);

  // Automatically refresh catalog when coming back online
  useEffect(() => {
    const handleOnline = () => {
      fetchBrowseItems();
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("folio:connection-restored", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("folio:connection-restored", handleOnline);
    };
  }, [fetchBrowseItems]);

  const handleTryAgain = async () => {
    await checkOnlineStatus();
    fetchBrowseItems();
  };

  // Handle folder navigation
  const handleOpenFolder = (item: BrowseItem) => {
    setCurrentSeriesPath((prev) => [...prev, { id: item.id, name: item.name }]);
    setPage(1);
  };

  const handleNavigateToBreadcrumb = (index: number) => {
    if (index === -1) {
      setCurrentSeriesPath([]);
    } else {
      setCurrentSeriesPath((prev) => prev.slice(0, index + 1));
    }
    setPage(1);
  };

  // Search & Filter
  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  };

  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setSearchInput(val);
    if (val.trim() === "" && search !== "") {
      setSearch("");
      setPage(1);
    }
  };

  // Download book handler
  const handleDownloadBook = async (book: BrowseItem) => {
    if (!settings.downloadPath) {
      await alert({
        title: t("common.warning"),
        message: t("browse.needDownloadFolderAlert"),
        type: "warning",
      });
      return;
    }

    setDownloadStates((prev) => ({ ...prev, [book.id]: "downloading" }));
    try {
      const serverUrl = getServerUrl();
      if (!serverUrl) {
        throw new Error(t("browse.serverNotConfiguredAlert"));
      }
      const token = getAccessToken() || undefined;
      // Single request to get full book details including CFI progress and series metadata
      const bookDetail = await libraryApi.getBook(book.id, "cfi").catch((err) => {
        console.warn("Failed to fetch book detail:", err);
        return null;
      });

      const seriesPath = await resolveBookSeriesPath(
        book.id,
        currentSeriesPath,
        bookDetail,
      );

      const title = bookDetail?.title || book.name;
      const author =
        bookDetail?.author || book.author || t("common.unknownAuthor");
      const progress = bookDetail?.progress ?? book.progress;
      const fileName = `${title}.epub`;

      const savedPath = await fileManager.downloadBookFile({
        serverUrl,
        token,
        bookId: book.id,
        fileName,
        title,
        author,
        seriesName: seriesPath,
        baseDir: settings.downloadPath,
        progress: progress
          ? {
              location: progress.location,
              progressPercent: progress.progressPercent,
              isRead: progress.isRead,
              updatedAt: progress.updatedAt,
            }
          : undefined,
      });

      const localId = fileManager.getLocalBookId(savedPath, settings.downloadPath);
      await saveDbBookMapping(localId, book.id, savedPath);

      let coverUrl: string | undefined;
      try {
        const diskPath = await fileManager.getBookCoverPath(localId);
        if (diskPath) {
          coverUrl = convertFileSrc(diskPath);
        }
      } catch {
        // ignore
      }

      // Update in-memory caches if progress was present
      if (progress) {
        const pct = progress.progressPercent ?? 0;
        const isRead = progress.isRead ?? (pct >= 100);
        const loc = progress.location || "";
        const lastOpenedAt =
          progress.updatedAt || new Date().toISOString();
        if (loc || pct > 0 || isRead) {
          saveLastLocation(localId, loc, pct / 100);
          saveRecentBook({
            id: localId,
            title,
            author,
            coverUrl,
            filePath: savedPath,
            progressFraction: pct / 100,
            lastOpenedAt,
            fileName,
          });
        }
      }

      saveLocalBookCache(
        localId,
        {
          title,
          author,
          coverUrl,
          extracted: true,
        },
        savedPath,
      );

      setDownloadedPaths((prev) => ({ ...prev, [book.id]: savedPath }));
      setDownloadStates((prev) => ({ ...prev, [book.id]: "downloaded" }));
      onBookDownloaded?.();
    } catch (err: any) {
      console.error("Download error:", err);
      setDownloadStates((prev) => ({ ...prev, [book.id]: "error" }));
      await alert({
        title: t("common.error"),
        message: t("browse.downloadFailedAlert", { error: err?.message || err }),
        type: "error",
      });
    }
  };

  const totalPages = Math.ceil(totalItems / limit) || 1;

  return (
    <div
      className="library-view-container"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <header className="library-header">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
            flex: 1,
          }}
        >
          <button
            type="button"
            className="header-pill-btn"
            onClick={onBackToLocalLibrary}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexShrink: 0,
            }}
          >
            <ArrowLeft size={16} />
            <span>{t("browse.myBooks")}</span>
          </button>

          <div className="library-brand" style={{ minWidth: 0 }}>
            <div>
              <h1
                className="library-title"
                style={{
                  fontSize: 16,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {t("browse.title")}
              </h1>
              <p className="library-subtitle">{t("browse.subtitle")}</p>
            </div>
          </div>
        </div>

        <button
          type="button"
          className="header-icon-btn"
          onClick={fetchBrowseItems}
          title={t("common.refresh")}
          style={{ flexShrink: 0 }}
        >
          <RefreshCw size={17} className={isLoading ? "animate-spin" : ""} />
        </button>
      </header>

      {/* Main Content Area */}
      <main
        className="library-main-content"
        style={{ flex: "1 1 0%", minHeight: 0, overflowY: "auto" }}
      >
        {/* Navigation Breadcrumb & Toolbar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Breadcrumb Navigation */}
          <nav
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              color: "var(--text-secondary)",
              overflowX: "auto",
              whiteSpace: "nowrap",
              paddingBottom: 2,
            }}
          >
            <button
              type="button"
              onClick={() => handleNavigateToBreadcrumb(-1)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                color:
                  currentSeriesPath.length === 0
                    ? "var(--accent-color)"
                    : "var(--text-secondary)",
                fontWeight: currentSeriesPath.length === 0 ? 700 : 500,
                cursor: "pointer",
                flexShrink: 0,
              }}
            >
              <Home size={15} />
              <span>{t("browse.mainCatalog")}</span>
            </button>

            {currentSeriesPath.map((folder, idx) => {
              const isLast = idx === currentSeriesPath.length - 1;
              return (
                <React.Fragment key={folder.id}>
                  <ChevronRight
                    size={14}
                    style={{ color: "var(--text-muted)", flexShrink: 0 }}
                  />
                  <button
                    type="button"
                    onClick={() => handleNavigateToBreadcrumb(idx)}
                    style={{
                      color: isLast
                        ? "var(--accent-color)"
                        : "var(--text-secondary)",
                      fontWeight: isLast ? 700 : 500,
                      cursor: "pointer",
                      maxWidth: 160,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                    title={folder.name}
                  >
                    {folder.name}
                  </button>
                </React.Fragment>
              );
            })}
          </nav>

          {/* Search & Filters */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 8,
            }}
          >
            {/* Search input */}
            <form
              onSubmit={handleSearchSubmit}
              style={{ flex: "1 1 200px", minWidth: 160, position: "relative" }}
              autoComplete="off"
            >
              <Search
                size={16}
                style={{
                  position: "absolute",
                  left: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--text-muted)",
                }}
              />
              <input
                type="text"
                value={searchInput}
                onChange={handleSearchInputChange}
                placeholder={t("browse.searchPlaceholder")}
                className="auth-input"
                style={{
                  paddingLeft: 36,
                  paddingRight: searchInput ? 32 : 12,
                  height: 38,
                  fontSize: 13,
                }}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput("");
                    setSearch("");
                    setPage(1);
                  }}
                  style={{
                    position: "absolute",
                    right: 10,
                    top: "50%",
                    transform: "translateY(-50%)",
                    color: "var(--text-muted)",
                    padding: 2,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                  title={t("library.clearSearch")}
                >
                  <X size={14} />
                </button>
              )}
            </form>

            <div
              style={{
                display: "flex",
                gap: 8,
                flex: "1 1 auto",
                minWidth: 0,
                alignItems: "center",
              }}
            >
              {/* Filter Scope */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <Select<'all' | 'title' | 'author' | 'series'>
                  value={searchBy}
                  onChange={(val) => {
                    setSearchBy(val);
                    setPage(1);
                  }}
                  icon={<Filter size={14} />}
                  triggerStyle={{
                    backgroundColor: "var(--bg-card)",
                    fontSize: 12,
                    height: 38,
                    padding: "0 8px",
                  }}
                  options={[
                    { value: "all", label: t("browse.allFields") },
                    { value: "title", label: t("browse.byTitle") },
                    { value: "author", label: t("browse.byAuthor") },
                    { value: "series", label: t("browse.bySeries") },
                  ]}
                  aria-label={t("browse.allFields")}
                />
              </div>

              {/* Sort Dropdown */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <Select<'name' | 'recent' | 'sortOrder'>
                  value={sortBy}
                  onChange={(val) => {
                    setSortBy(val);
                    setPage(1);
                  }}
                  icon={<ArrowUpDown size={14} />}
                  triggerStyle={{
                    backgroundColor: "var(--bg-card)",
                    fontSize: 12,
                    height: 38,
                    padding: "0 8px",
                  }}
                  options={[
                    { value: "name", label: t("browse.byName") },
                    { value: "recent", label: t("browse.newestFirst") },
                    { value: "sortOrder", label: t("browse.bySeriesOrder") },
                  ]}
                  aria-label={t("browse.byName")}
                />
              </div>

              {/* View mode toggle (Grid / List) */}
              <div className="view-mode-toggle-group" style={{ flexShrink: 0 }}>
                <button
                  type="button"
                  className={`view-mode-btn ${viewMode === "grid" ? "active" : ""}`}
                  onClick={() => handleToggleViewMode("grid")}
                  title={t("settings.viewGrid")}
                  aria-label={t("settings.viewGrid")}
                >
                  <LayoutGrid size={16} />
                </button>
                <button
                  type="button"
                  className={`view-mode-btn ${viewMode === "list" ? "active" : ""}`}
                  onClick={() => handleToggleViewMode("list")}
                  title={t("settings.viewList")}
                  aria-label={t("settings.viewList")}
                >
                  <ListIcon size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Content list / grid */}
        {isLoading ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "60px 0",
              gap: 12,
            }}
          >
            <Loader2
              size={32}
              className="animate-spin"
              style={{ color: "var(--accent-color)" }}
            />
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {t("browse.loadingCatalog")}
            </p>
          </div>
        ) : isOffline || (error && isNetworkError(error)) ? (
          <div
            className="library-empty-box"
            style={{
              borderColor: "rgba(234, 179, 8, 0.4)",
              padding: "36px 20px",
            }}
          >
            <WifiOff size={36} style={{ color: "#eab308", marginBottom: 8 }} />
            <p
              style={{
                color: "var(--text-primary)",
                fontWeight: 600,
                fontSize: 15,
                marginBottom: 4,
              }}
            >
              {t("browse.offlineTitle")}
            </p>
            <p
              style={{
                color: "var(--text-secondary)",
                fontSize: 13,
                maxWidth: 380,
                margin: "0 auto 16px",
                lineHeight: 1.5,
              }}
            >
              {t("browse.offlineDesc")}
            </p>
            <div
              style={{
                display: "flex",
                gap: 10,
                justifyContent: "center",
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                className="auth-btn-secondary"
                onClick={onBackToLocalLibrary}
              >
                {t("browse.backToLibrary")}
              </button>
              <button
                type="button"
                className="auth-btn-primary"
                onClick={handleTryAgain}
              >
                {t("browse.tryAgain")}
              </button>
            </div>
          </div>
        ) : error ? (
          <div
            className="library-empty-box"
            style={{ borderColor: "var(--danger-color)" }}
          >
            <p style={{ color: "var(--danger-color)", fontWeight: 600 }}>
              {error}
            </p>
            <button
              type="button"
              className="auth-btn-primary"
              onClick={handleTryAgain}
              style={{ marginTop: 8 }}
            >
              {t("browse.tryAgain")}
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="library-empty-box">
            <Sparkles size={32} className="empty-box-icon" />
            <p>
              {search
                ? t("browse.noItemsQuery")
                : currentSeriesPath.length > 0
                  ? t("browse.noBooksSeries")
                  : t("browse.catalogEmpty")}
            </p>
          </div>
        ) : viewMode === "grid" ? (
          <div className="books-grid" style={{ marginTop: 8 }}>
            {items.map((item) => {
              if (item.type === "series") {
                return (
                  <div
                    key={item.id}
                    className="book-card"
                    onClick={() => handleOpenFolder(item)}
                    style={{
                      borderColor: "rgba(168, 85, 247, 0.3)",
                      background:
                        "linear-gradient(to bottom right, rgba(168, 85, 247, 0.05), transparent)",
                    }}
                  >
                    <div
                      className="book-card-cover-wrap"
                      style={{
                        backgroundColor: "rgba(168, 85, 247, 0.1)",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 8,
                      }}
                    >
                      <div
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: "var(--radius-lg)",
                          backgroundColor: "rgba(168, 85, 247, 0.2)",
                          color: "#a855f7",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Folder size={28} />
                      </div>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: "#a855f7",
                          letterSpacing: "0.05em",
                          textTransform: "uppercase",
                        }}
                      >
                        {t("browse.bookSeries")}
                      </span>
                    </div>

                    <div className="book-card-details">
                      <h4 className="book-card-title" title={item.name}>
                        {item.name}
                      </h4>
                      <p
                        className="book-card-author"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          color: "#a855f7",
                        }}
                      >
                        <span>{t("browse.openFolder")}</span>
                        <ChevronRight size={12} />
                      </p>
                    </div>
                  </div>
                );
              }

              // Book Item Card
              const downloadStatus = downloadStates[item.id];
              const isDownloaded =
                downloadStatus === "downloaded" ||
                Boolean(downloadedPaths[item.id]);
              const isDownloading = downloadStatus === "downloading";
              const coverUrl = libraryApi.getBookCoverUrl(item.id);
              const progressPct = item.progress?.progressPercent ?? 0;

              return (
                <div key={item.id} className="book-card">
                  <div className="book-card-cover-wrap">
                    {/* Placeholder in background */}
                    <div className="book-card-cover-placeholder">
                      <BookOpen size={36} />
                    </div>

                    {/* Book Cover Image */}
                    <img
                      src={coverUrl}
                      alt={item.name}
                      className="book-card-cover"
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = "none";
                      }}
                    />

                    {/* Badges and Progress */}
                    {item.sortOrder !== undefined &&
                      item.sortOrder !== null && (
                        <span
                          style={{
                            position: "absolute",
                            top: 6,
                            left: 6,
                            backgroundColor: "rgba(0, 0, 0, 0.75)",
                            color: "#c084fc",
                            fontSize: 11,
                            fontWeight: 700,
                            fontFamily: "monospace",
                            padding: "2px 6px",
                            borderRadius: 6,
                            zIndex: 5,
                          }}
                        >
                          #{item.sortOrder}
                        </span>
                      )}

                    {isDownloaded && (
                      <span
                        style={{
                          position: "absolute",
                          top: 6,
                          right: 6,
                          backgroundColor: "#22c55e",
                          color: "#ffffff",
                          fontSize: 10,
                          fontWeight: 700,
                          padding: "2px 6px",
                          borderRadius: 6,
                          zIndex: 5,
                          display: "flex",
                          alignItems: "center",
                          gap: 3,
                        }}
                      >
                        <Check size={11} />
                        <span>{t("browse.downloaded")}</span>
                      </span>
                    )}

                    {progressPct > 0 && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: 0,
                          left: 0,
                          right: 0,
                          height: 4,
                          backgroundColor: "rgba(0, 0, 0, 0.4)",
                          zIndex: 5,
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${Math.min(100, Math.max(3, progressPct))}%`,
                            backgroundColor: "var(--accent-color)",
                          }}
                        />
                      </div>
                    )}
                  </div>

                  <div className="book-card-details">
                    <h4 className="book-card-title" title={item.name}>
                      {item.name}
                    </h4>
                    <p className="book-card-author" title={item.author}>
                      {item.author || t("common.unknownAuthor")}
                    </p>

                    <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                      {isDownloaded &&
                      downloadedPaths[item.id] &&
                      onOpenBookFromPath ? (
                        <button
                          type="button"
                          className="auth-btn-primary"
                          style={{
                            flex: 1,
                            padding: "6px 10px",
                            fontSize: 12,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 4,
                          }}
                          onClick={() =>
                            onOpenBookFromPath(
                              downloadedPaths[item.id],
                              item.name,
                              item.author,
                              item.id,
                            )
                          }
                        >
                          <BookOpen size={13} />
                          <span>{t("browse.read")}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={
                            isDownloaded
                              ? "auth-btn-secondary"
                              : "auth-btn-primary"
                          }
                          style={{
                            flex: 1,
                            padding: "6px 10px",
                            fontSize: 12,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 4,
                          }}
                          onClick={() => handleDownloadBook(item)}
                          disabled={isDownloading}
                        >
                          {isDownloading ? (
                            <>
                              <Loader2 size={13} className="animate-spin" />
                              <span>{t("browse.downloading")}</span>
                            </>
                          ) : isDownloaded ? (
                            <>
                              <CheckCircle2
                                size={13}
                                style={{ color: "#22c55e" }}
                              />
                              <span>{t("browse.download")}</span>
                            </>
                          ) : (
                            <>
                              <Download size={13} />
                              <span>{t("browse.download")}</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="books-list" style={{ marginTop: 8 }}>
            {items.map((item) => {
              if (item.type === "series") {
                return (
                  <div
                    key={item.id}
                    className="folder-list-item"
                    onClick={() => handleOpenFolder(item)}
                  >
                    <div className="folder-list-thumbnail-wrap">
                      <div
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: "var(--radius-md)",
                          backgroundColor: "rgba(168, 85, 247, 0.15)",
                          color: "#a855f7",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Folder size={22} />
                      </div>
                    </div>

                    <div className="book-list-details">
                      <div className="folder-list-title-row">
                        <h4 className="book-list-title folder-title">
                          {item.name}
                        </h4>
                        <span
                          className="folder-list-badge"
                          style={{
                            backgroundColor: "rgba(168, 85, 247, 0.15)",
                            color: "#a855f7",
                            border: "1px solid rgba(168, 85, 247, 0.25)",
                          }}
                        >
                          {t("browse.bookSeries")}
                        </span>
                      </div>
                      <p
                        className="folder-list-hint"
                        style={{ color: "#a855f7" }}
                      >
                        {t("library.collectionFolderHint")}
                      </p>
                    </div>

                    <div className="folder-list-right">
                      <ChevronRight
                        size={18}
                        className="folder-list-arrow"
                        style={{ color: "#a855f7" }}
                      />
                    </div>
                  </div>
                );
              }

              // Book Item in List View
              const downloadStatus = downloadStates[item.id];
              const isDownloaded =
                downloadStatus === "downloaded" ||
                Boolean(downloadedPaths[item.id]);
              const isDownloading = downloadStatus === "downloading";
              const coverUrl = libraryApi.getBookCoverUrl(item.id);
              const progressPct = item.progress?.progressPercent ?? 0;
              const isRead = Boolean(item.progress?.isRead);
              const readingStatus = isRead
                ? t("common.completed")
                : progressPct > 0
                  ? `${Math.round(progressPct)}%`
                  : t("common.notStarted");

              return (
                <div
                  key={item.id}
                  className="book-list-item"
                  style={{
                    cursor:
                      isDownloaded &&
                      downloadedPaths[item.id] &&
                      onOpenBookFromPath
                        ? "pointer"
                        : "default",
                  }}
                  onClick={() => {
                    if (
                      isDownloaded &&
                      downloadedPaths[item.id] &&
                      onOpenBookFromPath
                    ) {
                      onOpenBookFromPath(
                        downloadedPaths[item.id],
                        item.name,
                        item.author,
                        item.id,
                      );
                    }
                  }}
                >
                  {/* Cover thumbnail */}
                  <div
                    className="book-list-thumbnail-wrap"
                    style={{ position: "relative" }}
                  >
                    <div className="book-list-thumbnail-placeholder">
                      <BookOpen size={20} />
                    </div>
                    <img
                      src={coverUrl}
                      alt={item.name}
                      className="book-list-thumbnail"
                      loading="lazy"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = "none";
                      }}
                      style={{ position: "absolute", inset: 0 }}
                    />
                  </div>

                  {/* Book Info */}
                  <div className="book-list-details">
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        flexWrap: "wrap",
                      }}
                    >
                      <h4 className="book-list-title" title={item.name}>
                        {item.name}
                      </h4>
                      {item.sortOrder !== undefined &&
                        item.sortOrder !== null && (
                          <span
                            style={{
                              backgroundColor: "rgba(168, 85, 247, 0.15)",
                              color: "#c084fc",
                              fontSize: 10,
                              fontWeight: 700,
                              fontFamily: "monospace",
                              padding: "1px 5px",
                              borderRadius: 4,
                            }}
                          >
                            #{item.sortOrder}
                          </span>
                        )}
                    </div>

                    <p className="book-list-author" title={item.author}>
                      {item.author || t("common.unknownAuthor")}
                    </p>

                    {progressPct > 0 && (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          marginTop: 2,
                          maxWidth: 160,
                        }}
                      >
                        <div
                          style={{
                            flex: 1,
                            height: 4,
                            backgroundColor: "var(--bg-tertiary)",
                            borderRadius: 2,
                            overflow: "hidden",
                          }}
                        >
                          <div
                            style={{
                              height: "100%",
                              width: `${Math.min(100, Math.max(5, progressPct))}%`,
                              backgroundColor: isRead
                                ? "#22c55e"
                                : "var(--accent-color)",
                              borderRadius: 2,
                            }}
                          />
                        </div>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--text-secondary)",
                          }}
                        >
                          {Math.round(progressPct)}%
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Reading / Download status info */}
                  <div className="book-list-reading-info">
                    {isDownloaded ? (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 3,
                          color: "#22c55e",
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        <Check size={12} />
                        <span>{t("browse.downloaded")}</span>
                      </span>
                    ) : (
                      <span className="book-list-status">{readingStatus}</span>
                    )}
                  </div>

                  {/* Action button */}
                  <div
                    className="book-list-actions"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {isDownloaded &&
                    downloadedPaths[item.id] &&
                    onOpenBookFromPath ? (
                      <button
                        type="button"
                        className="auth-btn-primary"
                        style={{
                          padding: "6px 12px",
                          fontSize: 12,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          whiteSpace: "nowrap",
                        }}
                        onClick={() =>
                          onOpenBookFromPath(
                            downloadedPaths[item.id],
                            item.name,
                            item.author,
                            item.id,
                          )
                        }
                      >
                        <BookOpen size={13} />
                        <span>{t("browse.read")}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={
                          isDownloaded
                            ? "auth-btn-secondary"
                            : "auth-btn-primary"
                        }
                        style={{
                          padding: "6px 12px",
                          fontSize: 12,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          whiteSpace: "nowrap",
                        }}
                        onClick={() => handleDownloadBook(item)}
                        disabled={isDownloading}
                      >
                        {isDownloading ? (
                          <>
                            <Loader2 size={13} className="animate-spin" />
                            <span>{t("browse.downloading")}</span>
                          </>
                        ) : isDownloaded ? (
                          <>
                            <CheckCircle2
                              size={13}
                              style={{ color: "#22c55e" }}
                            />
                            <span>{t("browse.download")}</span>
                          </>
                        ) : (
                          <>
                            <Download size={13} />
                            <span>{t("browse.download")}</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && !isLoading && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "16px 0 24px 0",
              borderTop: "1px solid var(--border-color)",
              marginTop: 20,
              flexShrink: 0,
            }}
          >
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {t("reader.pageLabel", { label: `${page} / ${totalPages}` })} (
              {totalItems})
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="auth-btn-secondary"
                style={{ padding: "6px 12px", fontSize: 12 }}
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                {t("common.prev")}
              </button>
              <button
                type="button"
                className="auth-btn-secondary"
                style={{ padding: "6px 12px", fontSize: 12 }}
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t("common.next")}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
