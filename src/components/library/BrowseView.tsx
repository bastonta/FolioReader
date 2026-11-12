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
  Info,
  Layers,
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
import {
  BookHasNoChaptersError,
  BookHasNoFileError,
  BrowseParams,
  VolumesNotSupportedError,
  libraryApi,
} from "../../api/libraryApi";
import { Select } from "../common/Select";
import {
  getServerUrl,
  isNetworkError,
  isUnauthorizedError,
  withFreshAccessToken,
} from "../../api/tokenManager";
import { useAuth } from "../../context/AuthContext";
import { useDialog } from "../../context/DialogContext";
import { useTranslation } from "../../i18n";
import { useBackHandler } from "../../services/backHandler";
import { fileManager } from "../../services/fileManager";
import {
  saveDbBookMapping,
  fetchServerBookStatistics,
  deleteBookStatistics,
  checkDownloadedServerBooks,
  getChapterCopies,
  getLocalBookIdForFile,
} from "../../services/readerDb";
import {
  saveRecentBook,
  saveLastLocation,
  saveLocalBookCache,
} from "../../services/storage";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  BrowseItem,
  BookDetail,
  BookVolume,
  ChapterCopy,
  ChaptersBookDownloadResult,
  ChaptersDownloadProgress,
} from "../../types/browse";
import { ReaderSettings, BookMetadata, BookReadingStats } from "../../types/reader";
import { BookInfoModal } from "../reader/BookInfoModal";
import { ChapterVolumesModal } from "./ChapterVolumesModal";

/**
 * Key of a download: the book id for a whole book, `bookId#volume` for a single volume
 * of a `Chapters` book (each volume is a file of its own).
 */
const downloadKey = (bookId: string, volume?: number | null): string =>
  volume === undefined || volume === null ? bookId : `${bookId}#${volume}`;

/** How many times the access token may be renewed while one book is built from chapters. */
const CHAPTERS_BUILD_TOKEN_RENEWALS = 12;

/** How far a build from chapters has got, as a number that grows with every step of it. */
const chaptersBuildStage = (progress: ChaptersDownloadProgress): number => {
  const phase =
    progress.phase === "chapters" ? 0 : progress.phase === "images" ? 1 : 2;
  return phase * 1_000_000_000 + progress.done;
};

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
  // Progress of building local copies of `Chapters` books: download key -> last progress event
  const [chaptersProgress, setChaptersProgress] = useState<
    Record<string, ChaptersDownloadProgress>
  >({});
  // Volumes of the `Chapters` books on the page (only books the server lists volumes for)
  const [bookVolumes, setBookVolumes] = useState<Record<string, BookVolume[]>>(
    {},
  );
  // Local copies of `Chapters` books: the whole book and single volumes
  const [chapterCopies, setChapterCopies] = useState<
    Record<string, ChapterCopy[]>
  >({});
  // Book whose volumes are being chosen
  const [volumesModalBook, setVolumesModalBook] = useState<BrowseItem | null>(
    null,
  );

  // Book Info Modal state
  const [selectedBookForInfo, setSelectedBookForInfo] = useState<{
    isOpen: boolean;
    book: BrowseItem | null;
    metadata: BookMetadata | null;
    progressPercent?: number;
    stats: BookReadingStats | null;
  }>({
    isOpen: false,
    book: null,
    metadata: null,
    stats: null,
  });

  useBackHandler(
    () => {
      setSelectedBookForInfo((prev) => ({ ...prev, isOpen: false, book: null }));
      return true;
    },
    selectedBookForInfo.isOpen,
    110
  );

  useBackHandler(
    () => {
      setVolumesModalBook(null);
      return true;
    },
    volumesModalBook !== null,
    110
  );

  // Reloads which copies of the given `Chapters` books are on this device
  const refreshChapterCopies = useCallback(async (bookIds: string[]) => {
    if (bookIds.length === 0) return;
    const copies = await getChapterCopies(bookIds);
    setChapterCopies((prev) => {
      const next = { ...prev };
      for (const id of bookIds) next[id] = copies[id] ?? [];
      return next;
    });
  }, []);

  const handleOpenBookInfo = async (book: BrowseItem, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();

    const progressPct = book.progress?.progressPercent ?? 0;
    const coverUrl = libraryApi.getBookCoverUrl(book.id);

    const initialMeta: BookMetadata = {
      title: book.name,
      author: book.author || t("common.unknownAuthor"),
      coverUrl,
    };

    setSelectedBookForInfo({
      isOpen: true,
      book,
      metadata: initialMeta,
      progressPercent: progressPct,
      stats: null,
    });

    try {
      const [detail, stats] = await Promise.all([
        libraryApi.getBook(book.id, "cfi").catch(() => null),
        fetchServerBookStatistics(book.id).catch(() => null),
      ]);

      setSelectedBookForInfo((prev) => {
        if (prev.book?.id !== book.id) return prev;
        return {
          ...prev,
          metadata: {
            title: detail?.title || book.name,
            author: detail?.author || book.author || t("common.unknownAuthor"),
            coverUrl,
            description: detail?.description || undefined,
            language: detail?.language || undefined,
          },
          stats,
        };
      });
    } catch (err) {
      console.warn("Failed to load full book details/stats in browse view:", err);
    }
  };

  const handleResetStatsInBrowse = async () => {
    const currentBook = selectedBookForInfo.book;
    if (!currentBook) return;
    await deleteBookStatistics(currentBook.id);
    setSelectedBookForInfo((prev) => ({
      ...prev,
      stats: {
        bookId: currentBook.id,
        totalDurationSeconds: 0,
        sessionCount: 0,
        totalPagesRead: 0,
        averageSecondsPerPage: null,
        estimatedRemainingSeconds: null,
        firstReadAt: null,
        lastReadAt: null,
        deviceBreakdown: [],
      },
    }));
  };

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

  // Catalog requests are answered in any order. Only the answer to the latest request
  // is shown: an older one belongs to another folder, page or search, and showing it
  // under the current breadcrumb would also send downloads to the wrong folder.
  const browseRequestRef = React.useRef(0);

  // Fetch browse items
  const fetchBrowseItems = useCallback(async () => {
    const requestId = ++browseRequestRef.current;
    const isLatest = () => requestId === browseRequestRef.current;
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
      if (!isLatest()) return;
      setItems(res.items || []);
      setTotalItems(res.total || 0);

      // Check which books are already downloaded locally using SQLite mappings and disk check
      if (settings.downloadPath && res.items) {
        const bookItems = res.items.filter((i) => i.type === "book");
        if (bookItems.length > 0) {
          const newPaths: Record<string, string> = {};
          const newStates: Record<
            string,
            "downloading" | "downloaded" | "error"
          > = {};

          // 1. Fast batch check in SQLite book_mappings with disk file verification
          const downloadedMap = await checkDownloadedServerBooks(
            bookItems.map((b) => b.id)
          );
          if (!isLatest()) return;

          for (const [serverId, filePath] of Object.entries(downloadedMap)) {
            newPaths[serverId] = filePath;
            newStates[serverId] = "downloaded";
          }

          // 2. Fallback check for any books not yet found in SQLite mappings (e.g. legacy downloads)
          // A local copy of a `Chapters` book is always recorded in book_mappings when it is
          // built. For the rest a file with the name of the book is not enough: "Volume 1"
          // of another series has the same name, and binding it would send the reading
          // progress and annotations of that book into this one. The core accepts a file
          // only when the server recognises its content as this very book, and records
          // the binding itself.
          const unmappedBooks = bookItems.filter(
            (b) => !newPaths[b.id] && b.kind !== "Chapters",
          );
          const serverUrl = getServerUrl();
          if (unmappedBooks.length > 0 && serverUrl) {
            const seriesPath =
              currentSeriesPath.map((s) => s.name).join("/") || undefined;
            await Promise.all(
              unmappedBooks.map(async (book) => {
                try {
                  const existingPath = await withFreshAccessToken((token) =>
                    fileManager.findDownloadedBook({
                      serverUrl,
                      token,
                      bookId: book.id,
                      fileName: `${book.name}.epub`,
                      seriesName:
                        settings.createSeriesFolder !== false
                          ? seriesPath
                          : undefined,
                      baseDir: settings.downloadPath!,
                    }),
                  );
                  if (existingPath) {
                    newPaths[book.id] = existingPath;
                    newStates[book.id] = "downloaded";
                  }
                } catch (err) {
                  console.warn("Failed to look for a downloaded book:", err);
                }
              })
            );
            if (!isLatest()) return;
          }

          if (Object.keys(newPaths).length > 0) {
            setDownloadedPaths((prev) => ({ ...prev, ...newPaths }));
            setDownloadStates((prev) => ({ ...prev, ...newStates }));
          }
        }
      }

      // Books stored as chapters can be downloaded one volume at a time: find out which
      // of them have several volumes and which copies are already here. Neither request
      // holds the catalog back; a server that cannot list volumes leaves the map empty.
      const chapterBookIds = (res.items || [])
        .filter((i) => i.type === "book" && i.kind === "Chapters")
        .map((i) => i.id);
      if (chapterBookIds.length > 0) {
        refreshChapterCopies(chapterBookIds).catch(console.warn);
        Promise.all(
          chapterBookIds.map(
            async (id) => [id, await libraryApi.getBookVolumes(id)] as const,
          ),
        )
          .then((entries) => {
            setBookVolumes((prev) => {
              const next = { ...prev };
              for (const [id, volumes] of entries) {
                if (volumes) next[id] = volumes;
                else delete next[id];
              }
              return next;
            });
          })
          .catch(console.warn);
      }
    } catch (err: any) {
      if (!isLatest()) return;
      console.error("Failed to browse library:", err);
      setError(err?.message || "Failed to load catalog from server");
    } finally {
      if (isLatest()) setIsLoading(false);
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
    refreshChapterCopies,
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

  // A `Chapters` book the server lists several volumes for: it can be downloaded whole
  // or one volume at a time
  const hasVolumeChoice = (book: BrowseItem): boolean =>
    book.kind === "Chapters" && (bookVolumes[book.id]?.length ?? 0) > 1;

  const getVolumeCopies = (bookId: string): ChapterCopy[] =>
    (chapterCopies[bookId] ?? []).filter(
      (c) => c.volume !== null && c.volume !== undefined,
    );

  // Key of the download of this book that is running now: the whole book or one of its volumes
  const getActiveDownloadKey = (bookId: string): string | null => {
    if (downloadStates[bookId] === "downloading") return bookId;
    const prefix = `${bookId}#`;
    return (
      Object.keys(downloadStates).find(
        (key) => key.startsWith(prefix) && downloadStates[key] === "downloading",
      ) ?? null
    );
  };

  // Text of the action button while a book is being downloaded
  const getDownloadingLabel = (key: string): string => {
    const progress = chaptersProgress[key];
    if (!progress) return t("browse.downloading");
    if (progress.phase === "building") return t("browse.buildingBook");
    return t(
      progress.phase === "images"
        ? "browse.imagesProgress"
        : "browse.chaptersProgress",
      { done: progress.done, total: progress.total },
    );
  };

  // Download book handler.
  // Books assembled from chapters live on the server without an EPUB file (`/download`
  // answers 409): for them a local EPUB is built from the chapters. Calling the handler
  // again for such a book that is already downloaded fetches new and changed chapters.
  // With `volume` only that volume of such a book is downloaded (or updated), as a file
  // of its own.
  const handleDownloadBook = async (book: BrowseItem, volume?: number) => {
    const key = downloadKey(book.id, volume);
    if (!settings.downloadPath) {
      await alert({
        title: t("common.warning"),
        message: t("browse.needDownloadFolderAlert"),
        type: "warning",
      });
      return;
    }

    setDownloadStates((prev) => ({ ...prev, [key]: "downloading" }));
    try {
      const serverUrl = getServerUrl();
      if (!serverUrl) {
        throw new Error(t("browse.serverNotConfiguredAlert"));
      }
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

      const downloadOptions = {
        serverUrl,
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
      };

      let isChaptersBook =
        volume !== undefined ||
        (bookDetail?.kind ?? book.kind) === "Chapters";
      let savedPath = "";
      // The core cannot refresh the access token: it gets one that is known to be
      // valid, and a fresh one if the server still turns it down.
      if (!isChaptersBook) {
        try {
          savedPath = await withFreshAccessToken((token) =>
            fileManager.downloadBookFile({ ...downloadOptions, token }),
          );
        } catch (err) {
          // The catalog item did not say so, but the server has no file for this book
          if (!(err instanceof BookHasNoFileError)) throw err;
          isChaptersBook = true;
        }
      }

      let chaptersResult: ChaptersBookDownloadResult | null = null;
      if (isChaptersBook) {
        // Building a large book from chapters can outlive several access tokens. The
        // build is repeated with a new token as long as every run gets further than
        // the runs before it (the core continues an interrupted build); a run that
        // only gets as far as an earlier one would never finish, and ends the download.
        let furthestRun = -1;
        chaptersResult = await withFreshAccessToken(async (token) => {
          let reached = 0;
          try {
            return await fileManager.downloadChaptersBook(
              { ...downloadOptions, token, volume },
              (event) => {
                reached = Math.max(reached, chaptersBuildStage(event));
                setChaptersProgress((prev) => ({ ...prev, [key]: event }));
              },
            );
          } catch (err) {
            if (isUnauthorizedError(err) && reached <= furthestRun) {
              throw new Error(t("browse.downloadNoSession"));
            }
            furthestRun = Math.max(furthestRun, reached);
            throw err;
          }
        }, CHAPTERS_BUILD_TOKEN_RENEWALS);
        savedPath = chaptersResult.filePath;
      }
      // A volume copy is titled and named after its volume
      const fileTitle = chaptersResult?.title || title;
      const savedFileName = chaptersResult
        ? savedPath.split(/[\\/]/).pop() || fileName
        : fileName;

      // The id the core recorded the file under (it is not always the one that follows
      // from the path: a file downloaded again keeps the id it had)
      const localId =
        chaptersResult?.localId ??
        (await getLocalBookIdForFile(savedPath, settings.downloadPath));
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

      // Update in-memory caches if progress was present.
      // Updating a copy built from chapters leaves the local reading progress as it is.
      // For a new one the core has already translated the server position (a chapter
      // reference, a percentage of the whole book) into the built EPUB: a volume copy
      // counts from its own first chapter and starts unread when the position is elsewhere.
      const startsWithProgress = chaptersResult
        ? !chaptersResult.updated &&
          chaptersResult.progressPercent !== null &&
          chaptersResult.progressPercent !== undefined
        : Boolean(progress);
      if (progress && startsWithProgress) {
        const pct = chaptersResult
          ? (chaptersResult.progressPercent ?? 0)
          : (progress.progressPercent ?? 0);
        const isRead = chaptersResult
          ? Boolean(chaptersResult.isRead)
          : (progress.isRead ?? (pct >= 100));
        const loc = chaptersResult
          ? chaptersResult.location || ""
          : progress.location || "";
        const lastOpenedAt =
          progress.updatedAt || new Date().toISOString();
        if (loc || pct > 0 || isRead) {
          saveLastLocation(localId, loc, pct / 100);
          saveRecentBook({
            id: localId,
            title: fileTitle,
            author,
            coverUrl,
            filePath: savedPath,
            lastLocation: loc || undefined,
            progressFraction: pct / 100,
            lastOpenedAt,
            fileName: savedFileName,
          });
        }
      }

      saveLocalBookCache(
        localId,
        {
          title: fileTitle,
          author,
          coverUrl,
          extracted: true,
        },
        savedPath,
      );

      // A single volume does not make the book itself "downloaded"
      if (volume === undefined) {
        setDownloadedPaths((prev) => ({ ...prev, [book.id]: savedPath }));
      }
      setDownloadStates((prev) => ({ ...prev, [key]: "downloaded" }));
      if (chaptersResult) {
        await refreshChapterCopies([book.id]);
      }
      onBookDownloaded?.();

      if (chaptersResult) {
        if (chaptersResult.imagesMissing > 0) {
          console.warn(
            `Book ${book.id}: ${chaptersResult.imagesMissing} illustration(s) are missing on the server`,
          );
        }
        if (chaptersResult.updated) {
          const isUpToDate =
            chaptersResult.chaptersFetched === 0 &&
            chaptersResult.imagesFetched === 0;
          const isVolume = volume !== undefined;
          await alert({
            title: fileTitle,
            message: isUpToDate
              ? t(
                  isVolume
                    ? "browse.volumeChaptersUpToDate"
                    : "browse.chaptersUpToDate",
                  { total: chaptersResult.chaptersTotal },
                )
              : t(
                  isVolume
                    ? "browse.volumeChaptersUpdated"
                    : "browse.chaptersUpdated",
                  {
                    count: chaptersResult.chaptersFetched,
                    total: chaptersResult.chaptersTotal,
                  },
                ),
            type: isUpToDate ? "info" : "success",
          });
        }
      }
    } catch (err: any) {
      console.error("Download error:", err);
      setDownloadStates((prev) => ({ ...prev, [key]: "error" }));
      const message =
        err instanceof BookHasNoFileError
          ? t("browse.downloadNoFileError")
          : err instanceof BookHasNoChaptersError
            ? t("browse.downloadNoChaptersError")
            : err instanceof VolumesNotSupportedError
              ? t("browse.downloadVolumesNotSupported")
              : isUnauthorizedError(err)
                ? t("browse.downloadNoSession")
                : err?.message || err;
      await alert({
        title: t("common.error"),
        message: t("browse.downloadFailedAlert", { error: message }),
        type: "error",
      });
    } finally {
      setChaptersProgress((prev) => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  // Main action of a book that is not downloaded as a whole: a book with several
  // volumes asks what to download first
  const handlePrimaryDownload = (book: BrowseItem) => {
    if (hasVolumeChoice(book)) {
      setVolumesModalBook(book);
    } else {
      handleDownloadBook(book);
    }
  };

  // Icon and text of that action
  const renderDownloadAction = (book: BrowseItem) => {
    const volumeCopies = hasVolumeChoice(book) ? getVolumeCopies(book.id) : [];
    if (volumeCopies.length > 0) {
      return (
        <>
          <Layers size={13} />
          <span>
            {t("browse.volumesDownloaded", { count: volumeCopies.length })}
          </span>
        </>
      );
    }
    return (
      <>
        <Download size={13} />
        <span>{t("browse.download")}</span>
      </>
    );
  };

  // Opens the volume chooser of a book that is already downloaded as a whole
  const renderVolumesButton = (book: BrowseItem) =>
    hasVolumeChoice(book) ? (
      <button
        type="button"
        className="auth-btn-secondary"
        style={{
          padding: "6px 8px",
          fontSize: 12,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        onClick={() => setVolumesModalBook(book)}
        title={t("browse.volumes")}
        aria-label={t("browse.volumes")}
      >
        <Layers size={13} />
      </button>
    ) : null;

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
              // The whole book or one of its volumes is being downloaded
              const activeDownload = getActiveDownloadKey(item.id);
              const isDownloading = activeDownload !== null;
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

                    {/* Book Info Button */}
                    <button
                      type="button"
                      style={{
                        position: "absolute",
                        top: 6,
                        left: 6,
                        backgroundColor: "rgba(0, 0, 0, 0.6)",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: "50%",
                        width: 24,
                        height: 24,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "pointer",
                        zIndex: 6,
                        backdropFilter: "blur(4px)",
                      }}
                      onClick={(e) => handleOpenBookInfo(item, e)}
                      title={t("browse.bookDetails")}
                      aria-label={t("browse.bookDetails")}
                    >
                      <Info size={13} />
                    </button>

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

                    {item.kind === "Chapters" && (
                      <span
                        style={{
                          position: "absolute",
                          bottom: 10,
                          left: 6,
                          backgroundColor: "rgba(0, 0, 0, 0.75)",
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
                        title={t("browse.chaptersBadgeHint")}
                      >
                        <ListIcon size={11} />
                        <span>{t("browse.chaptersBadge")}</span>
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
                    <p className="book-card-author" title={item.author ?? undefined}>
                      {item.author || t("common.unknownAuthor")}
                    </p>

                    <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
                      {isDownloaded &&
                      downloadedPaths[item.id] &&
                      onOpenBookFromPath ? (
                        <>
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
                                item.author ?? undefined,
                                item.id,
                              )
                            }
                            disabled={isDownloading}
                          >
                            {isDownloading ? (
                              <>
                                <Loader2 size={13} className="animate-spin" />
                                <span>{getDownloadingLabel(activeDownload ?? item.id)}</span>
                              </>
                            ) : (
                              <>
                                <BookOpen size={13} />
                                <span>{t("browse.read")}</span>
                              </>
                            )}
                          </button>
                          {item.kind === "Chapters" && (
                            <button
                              type="button"
                              className="auth-btn-secondary"
                              style={{
                                padding: "6px 8px",
                                fontSize: 12,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                              onClick={() => handleDownloadBook(item)}
                              disabled={isDownloading}
                              title={t("browse.updateChapters")}
                              aria-label={t("browse.updateChapters")}
                            >
                              <RefreshCw size={13} />
                            </button>
                          )}
                        {renderVolumesButton(item)}
                        </>
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
                          onClick={() => handlePrimaryDownload(item)}
                          disabled={isDownloading}
                        >
                          {isDownloading ? (
                            <>
                              <Loader2 size={13} className="animate-spin" />
                              <span>{getDownloadingLabel(activeDownload ?? item.id)}</span>
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
                            renderDownloadAction(item)
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
              // The whole book or one of its volumes is being downloaded
              const activeDownload = getActiveDownloadKey(item.id);
              const isDownloading = activeDownload !== null;
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
                      !isDownloading &&
                      downloadedPaths[item.id] &&
                      onOpenBookFromPath
                    ) {
                      onOpenBookFromPath(
                        downloadedPaths[item.id],
                        item.name,
                        item.author ?? undefined,
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
                      {item.kind === "Chapters" && (
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 3,
                            backgroundColor: "var(--bg-tertiary)",
                            color: "var(--text-secondary)",
                            fontSize: 10,
                            fontWeight: 700,
                            padding: "1px 5px",
                            borderRadius: 4,
                          }}
                          title={t("browse.chaptersBadgeHint")}
                        >
                          <ListIcon size={10} />
                          <span>{t("browse.chaptersBadge")}</span>
                        </span>
                      )}
                    </div>

                    <p className="book-list-author" title={item.author ?? undefined}>
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
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="auth-btn-secondary"
                      style={{
                        padding: "6px 8px",
                        fontSize: 12,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        whiteSpace: "nowrap",
                      }}
                      onClick={(e) => handleOpenBookInfo(item, e)}
                      title={t("browse.bookDetails")}
                      aria-label={t("browse.bookDetails")}
                    >
                      <Info size={13} />
                    </button>

                    {isDownloaded &&
                    downloadedPaths[item.id] &&
                    onOpenBookFromPath ? (
                      <>
                        {item.kind === "Chapters" && (
                          <button
                            type="button"
                            className="auth-btn-secondary"
                            style={{
                              padding: "6px 8px",
                              fontSize: 12,
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 4,
                              whiteSpace: "nowrap",
                            }}
                            onClick={() => handleDownloadBook(item)}
                            disabled={isDownloading}
                            title={t("browse.updateChapters")}
                            aria-label={t("browse.updateChapters")}
                          >
                            <RefreshCw size={13} />
                          </button>
                        )}
                        {renderVolumesButton(item)}
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
                              item.author ?? undefined,
                              item.id,
                            )
                          }
                          disabled={isDownloading}
                        >
                          {isDownloading ? (
                            <>
                              <Loader2 size={13} className="animate-spin" />
                              <span>{getDownloadingLabel(activeDownload ?? item.id)}</span>
                            </>
                          ) : (
                            <>
                              <BookOpen size={13} />
                              <span>{t("browse.read")}</span>
                            </>
                          )}
                        </button>
                      </>
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
                        onClick={() => handlePrimaryDownload(item)}
                        disabled={isDownloading}
                      >
                        {isDownloading ? (
                          <>
                            <Loader2 size={13} className="animate-spin" />
                            <span>{getDownloadingLabel(activeDownload ?? item.id)}</span>
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
                          renderDownloadAction(item)
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

      {/* Book Details & Statistics Modal */}
      {selectedBookForInfo.isOpen && selectedBookForInfo.book && (
        <BookInfoModal
          isOpen={selectedBookForInfo.isOpen}
          onClose={() =>
            setSelectedBookForInfo((prev) => ({
              ...prev,
              isOpen: false,
              book: null,
            }))
          }
          metadata={selectedBookForInfo.metadata}
          bookId={selectedBookForInfo.book.id}
          progressPercent={selectedBookForInfo.progressPercent}
          readingStats={selectedBookForInfo.stats}
          onResetStats={handleResetStatsInBrowse}
        />
      )}

      {/* Whole book or single volumes of a book stored as chapters */}
      {volumesModalBook && (
        <ChapterVolumesModal
          isOpen
          bookTitle={volumesModalBook.name}
          volumes={bookVolumes[volumesModalBook.id] ?? []}
          copies={chapterCopies[volumesModalBook.id] ?? []}
          isDownloading={(volume) =>
            downloadStates[downloadKey(volumesModalBook.id, volume)] ===
            "downloading"
          }
          getDownloadingLabel={(volume) =>
            getDownloadingLabel(downloadKey(volumesModalBook.id, volume))
          }
          onDownload={(volume) =>
            handleDownloadBook(volumesModalBook, volume ?? undefined)
          }
          onOpen={
            onOpenBookFromPath
              ? (copy) => {
                  if (!copy.filePath) return;
                  const book = volumesModalBook;
                  setVolumesModalBook(null);
                  onOpenBookFromPath(
                    copy.filePath,
                    copy.title || book.name,
                    book.author ?? undefined,
                    book.id,
                  );
                }
              : undefined
          }
          onClose={() => setVolumesModalBook(null)}
        />
      )}
    </div>
  );
};
