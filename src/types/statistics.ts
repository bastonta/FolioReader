export interface DeviceStatsResponse {
  deviceName: string;
  durationSeconds: number;
  sessionCount: number;
  percentage: number;
}

export interface ReadingSessionItem {
  clientSessionId: string;
  bookId: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  startProgress?: number | null;
  endProgress?: number | null;
  pagesRead?: number | null;
  deviceName?: string | null;
}

export interface BatchReadingSessionsRequest {
  sessions: ReadingSessionItem[];
}

export interface BatchReadingSessionsResponse {
  inserted: number;
  rejected: number;
}

export interface ReadingSummaryResponse {
  totalReadingTimeSeconds: number;
  booksCompletedCount: number;
  booksInProgressCount: number;
  totalSessionsCount: number;
  currentStreakDays: number;
  longestStreakDays: number;
  averageSecondsPerDay: number;
  topDeviceName?: string | null;
  deviceBreakdown: DeviceStatsResponse[];
}

export interface DailyActivityResponse {
  date: string;
  durationSeconds: number;
  pagesRead: number;
  sessionCount: number;
}

export interface BookReadingStatsResponse {
  bookId: string;
  totalDurationSeconds: number;
  sessionCount: number;
  totalPagesRead: number;
  averageSecondsPerPage?: number | null;
  estimatedRemainingSeconds?: number | null;
  firstReadAt?: string | null;
  lastReadAt?: string | null;
  deviceBreakdown: DeviceStatsResponse[];
}

export interface BookReadingStatisticsItemResponse {
  bookId: string;
  title: string;
  author: string;
  totalDurationSeconds: number;
  sessionCount: number;
  totalPagesRead: number;
  averageSecondsPerPage?: number | null;
  estimatedRemainingSeconds?: number | null;
  firstReadAt?: string | null;
  lastReadAt?: string | null;
  progressPercent?: number | null;
  isRead?: boolean | null;
  coverPath?: string | null;
  deviceBreakdown: DeviceStatsResponse[];
}
