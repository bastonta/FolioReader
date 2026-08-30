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

  // Keep currentFraction ref up-to-date
  useEffect(() => {
    currentFractionRef.current = currentFraction;
    if (startFractionRef.current === undefined || startFractionRef.current === 0) {
      startFractionRef.current = currentFraction;
    }
  }, [currentFraction]);

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

  // Save current active chunk to DB
  const saveCurrentChunk = useCallback(async () => {
    const duration = activeSecondsRef.current;
    if (duration >= 10 && bookId) {
      const now = Date.now();
      const startIso = new Date(startTimeRef.current).toISOString();
      const endIso = new Date(now).toISOString();
      const startProg = startFractionRef.current;
      const endProg = currentFractionRef.current;
      const pages = pagesReadRef.current;

      await saveDbReadingSession(
        bookId,
        duration,
        startIso,
        endIso,
        startProg,
        endProg,
        pages,
        'FolioApp'
      );

      // Reset chunk trackers
      activeSecondsRef.current = 0;
      setActiveSeconds(0);
      startTimeRef.current = now;
      startFractionRef.current = currentFractionRef.current;
      pagesReadRef.current = 0;

      // Silently refresh stats
      refreshStats();
    }
  }, [bookId, refreshStats]);

  // Record a page turn
  const recordPageTurn = useCallback(() => {
    lastActiveTimestampRef.current = Date.now();
    isIdleRef.current = false;
    pagesReadRef.current += 1;
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
          saveCurrentChunk();
        }
      }
    }, 1000);

    return () => {
      clearInterval(timer);
      window.removeEventListener('mousemove', handleUserActivity);
      window.removeEventListener('touchstart', handleUserActivity);
      window.removeEventListener('keydown', handleUserActivity);
      window.removeEventListener('scroll', handleUserActivity);

      // Save on unmount
      saveCurrentChunk();
    };
  }, [bookId, saveCurrentChunk]);

  return {
    stats,
    activeSeconds,
    recordPageTurn,
    refreshStats,
  };
}
