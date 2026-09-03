import {
  AlignLeft,
  BookmarkCheck,
  BookOpen,
  Building,
  Calendar,
  Check,
  Clock,
  Copy,
  Globe,
  Hash,
  RefreshCw,
  RotateCcw,
  Tag,
} from "lucide-react";
import React, { useEffect, useState } from "react";
import { useTranslation } from "../../i18n";
import { useDialog } from "../../context/DialogContext";
import {
  formatContributor,
  formatLanguageMap,
  parseSubjects,
} from "../../services/storage";
import {
  formatDuration,
  formatReadingSpeed,
  getDeviceDisplayInfo,
  formatDateOnly,
} from "../../services/timeFormat";
import { deleteBookStatistics } from "../../services/readerDb";
import { BookMetadata, BookReadingStats } from "../../types/reader";
import { Modal } from "../common/Modal";

import { DevicePageInfo } from "../../services/devicePaginator";

interface BookInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  metadata: BookMetadata | null;
  bookId?: string;
  progressPercent?: number;
  currentChapter?: string;
  pageInfo?: DevicePageInfo | null;
  readingStats?: BookReadingStats | null;
  onSyncProgress?: () => Promise<void> | void;
  isSyncing?: boolean;
  syncMessage?: string | null;
  onResetStats?: () => Promise<void> | void;
}

const formatLanguage = (lang?: any): string => {
  if (!lang) return "";
  const str = typeof lang === "string" ? lang : formatLanguageMap(lang);
  if (!str) return "";
  const map: Record<string, string> = {
    ru: "Русский (ru)",
    en: "English (en)",
    es: "Español (es)",
    fr: "Français (fr)",
    de: "Deutsch (de)",
    it: "Italiano (it)",
    zh: "中文 (zh)",
    ja: "日本語 (ja)",
    ko: "한국어 (ko)",
    uk: "Українська (uk)",
    pl: "Polski (pl)",
    pt: "Português (pt)",
    tr: "Türkçe (tr)",
    kk: "Қазақша (kk)",
  };
  const code = str.toLowerCase().trim();
  return map[code] || str;
};

export const BookInfoModal: React.FC<BookInfoModalProps> = ({
  isOpen,
  onClose,
  metadata,
  bookId,
  progressPercent,
  currentChapter,
  pageInfo,
  readingStats,
  onSyncProgress,
  isSyncing = false,
  syncMessage,
  onResetStats,
}) => {
  const { t, resolvedLanguage } = useTranslation();
  const { confirm, alert } = useDialog();
  const [copiedId, setCopiedId] = useState(false);
  const [localStats, setLocalStats] = useState<BookReadingStats | null | undefined>(readingStats);
  const [isResetting, setIsResetting] = useState(false);

  useEffect(() => {
    setLocalStats(readingStats);
  }, [readingStats]);

  const stats = localStats !== undefined ? localStats : readingStats;
  const hasStats = Boolean(
    stats && (stats.totalDurationSeconds > 0 || stats.sessionCount > 0)
  );

  const handleResetStatistics = async () => {
    const isConfirmed = await confirm({
      title: t("reader.resetStats"),
      message: t("reader.resetStatsConfirm"),
      type: "danger",
    });
    if (!isConfirmed) return;

    setIsResetting(true);
    try {
      if (onResetStats) {
        await onResetStats();
      } else if (bookId) {
        await deleteBookStatistics(bookId);
      }
      setLocalStats({
        bookId: bookId || "",
        totalDurationSeconds: 0,
        sessionCount: 0,
        totalPagesRead: 0,
        averageSecondsPerPage: null,
        estimatedRemainingSeconds: null,
        firstReadAt: null,
        lastReadAt: null,
        deviceBreakdown: [],
      });
      alert({
        title: t("reader.readingStats"),
        message: t("reader.resetStatsSuccess"),
        type: "success",
      });
    } catch (err: any) {
      console.warn("Failed to reset book stats:", err);
    } finally {
      setIsResetting(false);
    }
  };

  if (!metadata) return null;

  const subjects = parseSubjects(metadata.subject);

  const handleCopyIdentifier = () => {
    if (!metadata.identifier) return;
    const id = formatLanguageMap(metadata.identifier);
    if (!id) return;
    navigator.clipboard.writeText(id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t("reader.bookDetails")}
      maxWidth="580px"
    >
      <div className="book-info-layout">
        {/* Book Cover */}
        <div className="book-info-cover-wrap" style={{ position: "relative" }}>
          <div className="book-info-cover-placeholder">
            <BookOpen size={36} />
          </div>
          {metadata.coverUrl && (
            <img
              src={metadata.coverUrl}
              alt={metadata.title}
              className="book-info-cover-img"
              style={{ position: "absolute", inset: 0 }}
              onError={(e) => {
                (e.target as HTMLElement).style.display = "none";
              }}
            />
          )}
        </div>

        {/* Essential Metadata Info */}
        <div className="book-info-main-details">
          <h3
            className="book-info-title"
            title={formatLanguageMap(metadata.title)}
          >
            {formatLanguageMap(metadata.title) || t("common.untitledBook")}
          </h3>
          <h4
            className="book-info-author"
            title={formatContributor(metadata.author)}
          >
            {formatContributor(metadata.author) || t("common.unknownAuthor")}
          </h4>

          <div className="book-info-meta-list">
            {metadata.publisher && (
              <div className="book-info-meta-row">
                <Building size={14} className="book-info-icon" />
                <span className="book-info-meta-label">
                  {t("reader.publisher")}:
                </span>
                <span className="book-info-meta-value">
                  {formatContributor(metadata.publisher)}
                </span>
              </div>
            )}

            {metadata.published && (
              <div className="book-info-meta-row">
                <Calendar size={14} className="book-info-icon" />
                <span className="book-info-meta-label">
                  {t("reader.published")}:
                </span>
                <span className="book-info-meta-value">
                  {formatLanguageMap(metadata.published)}
                </span>
              </div>
            )}

            {metadata.language && (
              <div className="book-info-meta-row">
                <Globe size={14} className="book-info-icon" />
                <span className="book-info-meta-label">
                  {t("reader.language")}:
                </span>
                <span className="book-info-meta-value">
                  {formatLanguage(metadata.language)}
                </span>
              </div>
            )}

            {metadata.identifier && (
              <div className="book-info-meta-row">
                <Hash size={14} className="book-info-icon" />
                <span className="book-info-meta-label">
                  {t("reader.bookId")}:
                </span>
                <span
                  className="book-info-meta-value book-info-id-value"
                  title={formatLanguageMap(metadata.identifier)}
                >
                  {formatLanguageMap(metadata.identifier)}
                </span>
                <button
                  type="button"
                  className="book-info-copy-btn"
                  onClick={handleCopyIdentifier}
                  title={
                    copiedId ? t("common.copied") : t("reader.copyIdentifier")
                  }
                >
                  {copiedId ? (
                    <Check size={12} className="text-emerald-400" />
                  ) : (
                    <Copy size={12} />
                  )}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Genres / Subject Tag Chips */}
      {subjects.length > 0 && (
        <div className="book-info-section book-info-tags-section">
          <div className="book-info-section-header">
            <Tag size={14} className="book-info-icon" />
            <span className="book-info-section-title">
              {t("reader.subjectsGenres")}
            </span>
          </div>
          <div className="book-info-chips-list">
            {subjects.map((sub, idx) => (
              <span key={`${sub}-${idx}`} className="book-info-chip">
                {sub}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Reading Progress & Server Sync Card */}
      {(progressPercent !== undefined || onSyncProgress || pageInfo) && (
        <div className="book-info-progress-card">
          <div className="book-info-progress-header">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <BookmarkCheck size={16} className="book-info-icon" />
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}
              >
                {t("reader.readingProgress")}
              </span>
            </div>
            {progressPercent !== undefined && (
              <span className="book-info-progress-pct">
                {Math.round(progressPercent)}%
              </span>
            )}
          </div>

          {progressPercent !== undefined && (
            <div className="book-info-progress-track">
              <div
                className="book-info-progress-fill"
                style={{
                  width: `${Math.max(0, Math.min(100, progressPercent))}%`,
                }}
              />
            </div>
          )}

          {pageInfo && (
            <div
              className="book-info-pages-stats"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 8,
                fontSize: 12,
                color: "var(--text-secondary)",
              }}
            >
              <span>
                {t("reader.bookPages", {
                  current: pageInfo.bookPage,
                  total: pageInfo.totalBookPages,
                })}
              </span>
              <span>
                {t("reader.chapterPages", {
                  current: pageInfo.chapterPage,
                  total: pageInfo.totalChapterPages,
                })}
              </span>
            </div>
          )}

          {currentChapter && (
            <p className="book-info-progress-chapter" title={currentChapter}>
              {t("reader.currentChapter", { chapter: currentChapter })}
            </p>
          )}

          {onSyncProgress && (
            <div className="book-info-sync-row">
              <button
                type="button"
                className="book-info-sync-btn"
                onClick={onSyncProgress}
                disabled={isSyncing}
                title={t("reader.syncProgress")}
              >
                <RefreshCw
                  size={14}
                  className={isSyncing ? "animate-spin" : ""}
                />
                <span>
                  {isSyncing ? t("reader.syncing") : t("reader.syncProgress")}
                </span>
              </button>
              {syncMessage && (
                <span className="book-info-sync-msg">{syncMessage}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Reading Statistics Card */}
      <div className="book-info-progress-card" style={{ marginTop: 12 }}>
        <div className="book-info-progress-header">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Clock size={16} className="book-info-icon" style={{ color: "#3b82f6" }} />
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              {t("reader.readingStats")}
            </span>
          </div>
          {hasStats && (bookId || onResetStats) && (
            <button
              type="button"
              className="book-info-reset-btn"
              onClick={handleResetStatistics}
              disabled={isResetting}
              title={t("reader.resetStats")}
            >
              <RotateCcw size={13} className={isResetting ? "animate-spin" : ""} />
            </button>
          )}
        </div>

        {hasStats && stats ? (
          <>
            <div className="book-info-stats-grid">
              {/* 1. Total Reading Time */}
              <div className="book-info-stat-tile">
                <div className="book-info-stat-label">
                  {t("reader.totalReadingTime")}
                </div>
                <div className="book-info-stat-value">
                  {formatDuration(stats.totalDurationSeconds, t)}
                </div>
              </div>

              {/* 2. Reading Speed / Pace */}
              <div className="book-info-stat-tile">
                <div className="book-info-stat-label">
                  {t("reader.readingSpeed")}
                </div>
                <div className="book-info-stat-value">
                  {formatReadingSpeed(stats.averageSecondsPerPage, t)}
                </div>
              </div>

              {/* 3. Estimated Remaining */}
              <div className="book-info-stat-tile">
                <div className="book-info-stat-label">
                  {t("reader.estimatedRemaining")}
                </div>
                <div className="book-info-stat-value" style={{ color: "var(--accent-color)" }}>
                  {progressPercent !== undefined && progressPercent >= 99.9 ? (
                    <span style={{ color: "#10b981" }}>{t("reader.bookFinished")}</span>
                  ) : stats.estimatedRemainingSeconds !== undefined && stats.estimatedRemainingSeconds !== null ? (
                    stats.estimatedRemainingSeconds <= 0 ? (
                      <span style={{ color: "#10b981" }}>{t("reader.bookFinished")}</span>
                    ) : (
                      `~${formatDuration(stats.estimatedRemainingSeconds, t)}`
                    )
                  ) : (
                    "—"
                  )}
                </div>
              </div>

              {/* 4. Reading Sessions */}
              <div className="book-info-stat-tile">
                <div className="book-info-stat-label">
                  {t("reader.readingSessions")}
                </div>
                <div className="book-info-stat-value">
                  {stats.sessionCount}
                </div>
              </div>

              {/* 5. Total Pages Read */}
              {stats.totalPagesRead > 0 && (
                <div className="book-info-stat-tile">
                  <div className="book-info-stat-label">
                    {t("reader.totalPagesRead")}
                  </div>
                  <div className="book-info-stat-value">
                    {stats.totalPagesRead}
                  </div>
                </div>
              )}

              {/* 6. First Read Date */}
              {stats.firstReadAt && (
                <div className="book-info-stat-tile">
                  <div className="book-info-stat-label">
                    {t("reader.firstRead")}
                  </div>
                  <div className="book-info-stat-value">
                    {formatDateOnly(stats.firstReadAt, resolvedLanguage)}
                  </div>
                </div>
              )}

              {/* 7. Last Read Date */}
              {stats.lastReadAt && (
                <div className="book-info-stat-tile">
                  <div className="book-info-stat-label">
                    {t("reader.lastRead")}
                  </div>
                  <div className="book-info-stat-value">
                    {formatDateOnly(stats.lastReadAt, resolvedLanguage)}
                  </div>
                </div>
              )}
            </div>

            {/* Per-book Device Distribution */}
            {stats.deviceBreakdown && stats.deviceBreakdown.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border-subtle)" }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>
                  {t("reader.deviceDistribution")}
                </div>

                {/* Multi-segment progress bar */}
                <div
                  style={{
                    width: "100%",
                    height: 6,
                    borderRadius: 9999,
                    backgroundColor: "var(--bg-tertiary)",
                    overflow: "hidden",
                    display: "flex",
                  }}
                >
                  {stats.deviceBreakdown.map((dev, dIdx) => {
                    const devInfo = getDeviceDisplayInfo(dev.deviceName);
                    return (
                      <div
                        key={dIdx}
                        style={{
                          width: `${dev.percentage}%`,
                          backgroundColor: devInfo.barColor,
                          height: "100%",
                          transition: "width 0.3s ease",
                        }}
                        title={`${devInfo.label}: ${dev.percentage.toFixed(1)}% (${formatDuration(dev.durationSeconds, t)})`}
                      />
                    );
                  })}
                </div>

                {/* Device Badges with Percentages */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                  {stats.deviceBreakdown.map((dev, dIdx) => {
                    const devInfo = getDeviceDisplayInfo(dev.deviceName);
                    return (
                      <span
                        key={dIdx}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 5,
                          padding: "3px 8px",
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 500,
                          backgroundColor: "var(--bg-tertiary)",
                          border: `1px solid ${devInfo.borderColor}`,
                          color: "var(--text-primary)",
                        }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: "50%",
                            backgroundColor: devInfo.barColor,
                          }}
                        />
                        <span>
                          {devInfo.shortLabel}: {Math.round(dev.percentage)}% ({formatDuration(dev.durationSeconds, t)})
                        </span>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        ) : (
          <div
            style={{
              padding: "12px 10px",
              textAlign: "center",
              fontSize: 12,
              color: "var(--text-muted)",
            }}
          >
            {t("reader.noStatsYet")}
          </div>
        )}
      </div>

      {/* Book Description */}
      {metadata.description && (
        <div className="book-info-section book-info-description">
          <div className="book-info-section-header">
            <AlignLeft size={14} className="book-info-icon" />
            <h4 className="book-info-desc-heading">
              {t("reader.description")}
            </h4>
          </div>
          <div
            className="book-info-desc-body"
            dangerouslySetInnerHTML={{ __html: metadata.description }}
          />
        </div>
      )}
    </Modal>
  );
};
