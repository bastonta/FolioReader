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
  Tag,
} from "lucide-react";
import React, { useState } from "react";
import { useTranslation } from "../../i18n";
import {
  formatContributor,
  formatLanguageMap,
  parseSubjects,
} from "../../services/storage";
import { formatDuration } from "../../services/timeFormat";
import { BookMetadata, BookReadingStats } from "../../types/reader";
import { Modal } from "../common/Modal";

import { DevicePageInfo } from "../../services/devicePaginator";

interface BookInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  metadata: BookMetadata | null;
  progressPercent?: number;
  currentChapter?: string;
  pageInfo?: DevicePageInfo | null;
  readingStats?: BookReadingStats | null;
  onSyncProgress?: () => Promise<void> | void;
  isSyncing?: boolean;
  syncMessage?: string | null;
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
  progressPercent,
  currentChapter,
  pageInfo,
  readingStats,
  onSyncProgress,
  isSyncing = false,
  syncMessage,
}) => {
  const { t } = useTranslation();
  const [copiedId, setCopiedId] = useState(false);

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
      {readingStats && readingStats.totalDurationSeconds > 0 && (
        <div className="book-info-progress-card" style={{ marginTop: 12 }}>
          <div className="book-info-progress-header">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Clock size={16} className="book-info-icon text-amber-500" />
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
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
              gap: 10,
              marginTop: 8,
            }}
          >
            <div
              style={{
                padding: "8px 10px",
                background: "var(--bg-secondary)",
                borderRadius: 6,
              }}
            >
              <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                {t("reader.totalReadingTime")}
              </div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  marginTop: 2,
                }}
              >
                {formatDuration(readingStats.totalDurationSeconds, t)}
              </div>
            </div>

            {readingStats.estimatedRemainingSeconds !== undefined &&
              readingStats.estimatedRemainingSeconds !== null && (
                <div
                  style={{
                    padding: "8px 10px",
                    background: "var(--bg-secondary)",
                    borderRadius: 6,
                  }}
                >
                  <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                    {t("reader.estimatedRemaining")}
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      marginTop: 2,
                    }}
                  >
                    {readingStats.estimatedRemainingSeconds <= 0
                      ? t("reader.bookFinished")
                      : `~${formatDuration(readingStats.estimatedRemainingSeconds, t)}`}
                  </div>
                </div>
              )}

            <div
              style={{
                padding: "8px 10px",
                background: "var(--bg-secondary)",
                borderRadius: 6,
              }}
            >
              <div style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                {t("reader.readingSessions")}
              </div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                  marginTop: 2,
                }}
              >
                {readingStats.sessionCount}
              </div>
            </div>
          </div>
        </div>
      )}

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
