import { useEffect, useRef, useState, useCallback } from 'react';
import { BookReadingStats } from '../types/reader';
import { saveDbReadingSession, fetchServerBookStatistics } from './readerDb';

const IDLE_TIMEOUT_SECONDS = 120; // Pause timer after 2 minutes of inactivity
const AUTO_CHECKPOINT_SECONDS = 180; // Save session checkpoint every 3 minutes of active reading

export interface UseReadingTrackerOptions {
  bookId: string;
  currentFraction: number;
}

export function useReadingTracker({ bookId, currentFraction }: UseReadingTrackerOptions) {
  const [stats, setStats] = useState<BookReadingStats | null>(null);
  const [activeSeconds, setActiveSeconds] = useState<number>(0);

  const activeSecondsRef = useRef<number>(0);
  const startTimeRef = useRef<number>(Date.now());
  const startFractionRef = useRef<number>(currentFraction);
  const lastActiveTimestampRef = useRef<number>(Date.now());
  const pagesReadRef = useRef<number>(0);
  const isIdleRef = useRef<boolean>(false);
  const currentFractionRef = useRef<number>(currentFraction);
  const bookIdRef = useRef<string>(bookId);

  // Keep refs up-to-date
  useEffect(() => {
    currentFractionRef.current = currentFraction;
    if (startFractionRef.current === undefined || startFractionRef.current === 0) {
      startFractionRef.current = currentFraction;
    }
  }, [currentFraction]);

  useEffect(() => {
    bookIdRef.current = bookId;
  }, [bookId]);

  // Load stats from server or local DB
  const refreshStats = useCallback(async () => {
    if (!bookId) return;
    const loaded = await fetchServerBookStatistics(bookId);
    if (loaded) {
      setStats(loaded);
    }
  }, [bookId]);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  const savingPromiseRef = useRef<Promise<boolean> | null>(null);

  // Flush current session chunk. A flush that is already running is shared,
  // so every caller can wait until the chunk is really in the database.
  // Resolves to true when a chunk was written.
  const flushSession = useCallback((): Promise<boolean> => {
    if (savingPromiseRef.current) return savingPromiseRef.current;
    const duration = activeSecondsRef.current;
    const currentBookId = bookIdRef.current;
    if (duration < 10 || !currentBookId) return Promise.resolve(false);

    const run = (async () => {
      try {
        const now = Date.now();
        const startIso = new Date(startTimeRef.current).toISOString();
        const endIso = new Date(now).toISOString();
        const startProg = startFractionRef.current;
        const endProg = currentFractionRef.current;
        const pages = pagesReadRef.current;

        // Start the next chunk before the (asynchronous) write, so that
        // seconds counted while it is in flight belong to the next chunk
        activeSecondsRef.current = 0;
        setActiveSeconds(0);
        startTimeRef.current = now;
        startFractionRef.current = endProg;
        pagesReadRef.current = 0;

        await saveDbReadingSession(
          currentBookId,
          duration,
          startIso,
          endIso,
          startProg,
          endProg,
          pages,
          'FolioReader'
        );

        // Silently refresh stats
        refreshStats();
        return true;
      } catch (e) {
        console.warn('Failed to save reading session chunk:', e);
        return false;
      } finally {
        savingPromiseRef.current = null;
      }
    })();
    savingPromiseRef.current = run;
    return run;
  }, [refreshStats]);

  // Stable save function that reads current values from refs
  const saveCurrentChunkRef = useRef<(() => Promise<boolean>) | undefined>(undefined);
  saveCurrentChunkRef.current = flushSession;

  // Record a page turn
  const recordPageTurn = useCallback(() => {
    lastActiveTimestampRef.current = Date.now();
    isIdleRef.current = false;
    pagesReadRef.current += 1;
  }, []);

  // Record user activity that the window-level listeners below cannot see:
  // input inside the book's iframes does not reach the top window.
  const recordActivity = useCallback(() => {
    lastActiveTimestampRef.current = Date.now();
    isIdleRef.current = false;
  }, []);

  // Main active reading timer loop & idle detector
  useEffect(() => {
    if (!bookId) return;

    startTimeRef.current = Date.now();
    lastActiveTimestampRef.current = Date.now();
    activeSecondsRef.current = 0;
    pagesReadRef.current = 0;

    const handleUserActivity = () => {
      lastActiveTimestampRef.current = Date.now();
      if (isIdleRef.current) {
        isIdleRef.current = false;
      }
    };

    // Attach user activity listeners
    window.addEventListener('mousemove', handleUserActivity, { passive: true });
    window.addEventListener('touchstart', handleUserActivity, { passive: true });
    window.addEventListener('keydown', handleUserActivity, { passive: true });
    window.addEventListener('scroll', handleUserActivity, { passive: true });

    // Going to the background (Android minimise / screen off, desktop window
    // hidden): the app may be killed there, so the chunk collected so far is
    // written now instead of waiting for the next checkpoint. Coming back
    // starts the next chunk at the moment of return.
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveCurrentChunkRef.current?.();
      } else {
        const now = Date.now();
        lastActiveTimestampRef.current = now;
        isIdleRef.current = false;
        if (activeSecondsRef.current === 0) {
          startTimeRef.current = now;
        }
      }
    };
    const handlePageHide = () => {
      saveCurrentChunkRef.current?.();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageHide);

    const timer = setInterval(() => {
      const now = Date.now();
      const idleTimeSeconds = (now - lastActiveTimestampRef.current) / 1000;

      // Check if user is idle
      if (idleTimeSeconds >= IDLE_TIMEOUT_SECONDS) {
        isIdleRef.current = true;
      }

      // Increment active time only if visible, window focused, and not idle
      const isVisible = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;
      if (!isIdleRef.current && isVisible) {
        activeSecondsRef.current += 1;
        setActiveSeconds(activeSecondsRef.current);

        // Auto-checkpoint
        if (activeSecondsRef.current >= AUTO_CHECKPOINT_SECONDS) {
          saveCurrentChunkRef.current?.();
        }
      }
    }, 1000);

    return () => {
      clearInterval(timer);
      window.removeEventListener('mousemove', handleUserActivity);
      window.removeEventListener('touchstart', handleUserActivity);
      window.removeEventListener('keydown', handleUserActivity);
      window.removeEventListener('scroll', handleUserActivity);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', handlePageHide);

      // Save on unmount — uses ref to always call the latest version
      saveCurrentChunkRef.current?.();
    };
  }, [bookId]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    stats,
    activeSeconds,
    recordPageTurn,
    recordActivity,
    refreshStats,
    flushSession,
  };
}
