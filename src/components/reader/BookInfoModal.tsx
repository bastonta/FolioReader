import React, { useState } from 'react';
import { Modal } from '../common/Modal';
import { BookMetadata } from '../../types/reader';
import {
  Globe,
  Calendar,
  Building,
  Tag,
  Hash,
  BookOpen,
  RefreshCw,
  Copy,
  Check,
  AlignLeft,
  BookmarkCheck,
} from 'lucide-react';
import { useTranslation } from '../../i18n';
import { formatContributor, formatLanguageMap, parseSubjects } from '../../services/storage';

interface BookInfoModalProps {
  isOpen: boolean;
  onClose: () => void;
  metadata: BookMetadata | null;
  progressPercent?: number;
  currentChapter?: string;
  onSyncProgress?: () => Promise<void> | void;
  isSyncing?: boolean;
  syncMessage?: string | null;
}

const formatLanguage = (lang?: any): string => {
  if (!lang) return '';
  const str = typeof lang === 'string' ? lang : formatLanguageMap(lang);
  if (!str) return '';
  const map: Record<string, string> = {
    ru: 'Русский (ru)',
    en: 'English (en)',
    es: 'Español (es)',
    fr: 'Français (fr)',
    de: 'Deutsch (de)',
    it: 'Italiano (it)',
    zh: '中文 (zh)',
    ja: '日本語 (ja)',
    ko: '한국어 (ko)',
    uk: 'Українська (uk)',
    pl: 'Polski (pl)',
    pt: 'Português (pt)',
    tr: 'Türkçe (tr)',
    kk: 'Қазақша (kk)',
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
    <Modal isOpen={isOpen} onClose={onClose} title={t('reader.bookDetails')} maxWidth="580px">
      <div className="book-info-layout">
        {/* Book Cover */}
        <div className="book-info-cover-wrap" style={{ position: 'relative' }}>
          <div className="book-info-cover-placeholder">
            <BookOpen size={36} />
          </div>
          {metadata.coverUrl && (
            <img
              src={metadata.coverUrl}
              alt={metadata.title}
              className="book-info-cover-img"
              style={{ position: 'absolute', inset: 0 }}
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          )}
        </div>

        {/* Core Metadata */}
        <div className="book-info-details">
          <h3 className="book-info-title">{formatLanguageMap(metadata.title) || t('common.untitledBook')}</h3>
          <p className="book-info-author">{formatContributor(metadata.author) || t('common.unknownAuthor')}</p>

          <div className="book-info-meta-list">
            {metadata.publisher && (
              <div className="book-info-meta-item">
                <Building size={15} className="book-info-icon" />
                <span className="book-info-meta-label">{t('reader.publisher')}:</span>
                <span className="book-info-meta-val">{formatContributor(metadata.publisher)}</span>
              </div>
            )}

            {metadata.published && (
              <div className="book-info-meta-item">
                <Calendar size={15} className="book-info-icon" />
                <span className="book-info-meta-label">{t('reader.published')}:</span>
                <span className="book-info-meta-val">{formatLanguageMap(metadata.published)}</span>
              </div>
            )}

            {metadata.language && (
              <div className="book-info-meta-item">
                <Globe size={15} className="book-info-icon" />
                <span className="book-info-meta-label">{t('reader.language')}:</span>
                <span className="book-info-meta-val">{formatLanguage(metadata.language)}</span>
              </div>
            )}

            {metadata.identifier && (
              <div className="book-info-meta-item" style={{ alignItems: 'flex-start' }}>
                <Hash size={15} className="book-info-icon" style={{ marginTop: 2 }} />
                <span className="book-info-meta-label">{t('reader.bookId')}:</span>
                <div className="book-info-id-wrapper">
                  <span className="book-info-id-badge" title={formatLanguageMap(metadata.identifier)}>
                    {formatLanguageMap(metadata.identifier)}
                  </span>
                  <button
                    type="button"
                    className="book-info-copy-btn"
                    onClick={handleCopyIdentifier}
                    title={t('reader.copyIdentifier')}
                    aria-label={t('reader.copyIdentifier')}
                  >
                    {copiedId ? <Check size={12} style={{ color: '#22c55e' }} /> : <Copy size={12} />}
                  </button>
                </div>
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
            <span className="book-info-section-title">{t('reader.subjectsGenres')}</span>
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
      {(progressPercent !== undefined || onSyncProgress) && (
        <div className="book-info-progress-card">
          <div className="book-info-progress-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <BookmarkCheck size={16} className="book-info-icon" />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                {t('reader.readingProgress')}
              </span>
            </div>
            {progressPercent !== undefined && (
              <span className="book-info-progress-pct">{Math.round(progressPercent)}%</span>
            )}
          </div>

          {progressPercent !== undefined && (
            <div className="book-info-progress-track">
              <div
                className="book-info-progress-fill"
                style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%` }}
              />
            </div>
          )}

          {currentChapter && (
            <p className="book-info-progress-chapter" title={currentChapter}>
              {t('reader.currentChapter', { chapter: currentChapter })}
            </p>
          )}

          {onSyncProgress && (
            <div className="book-info-sync-row">
              <button
                type="button"
                className="book-info-sync-btn"
                onClick={onSyncProgress}
                disabled={isSyncing}
                title={t('reader.syncProgress')}
              >
                <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
                <span>{isSyncing ? t('reader.syncing') : t('reader.syncProgress')}</span>
              </button>
              {syncMessage && (
                <span className="book-info-sync-msg">{syncMessage}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Book Description */}
      {metadata.description && (
        <div className="book-info-section book-info-description">
          <div className="book-info-section-header">
            <AlignLeft size={14} className="book-info-icon" />
            <h4 className="book-info-desc-heading">{t('reader.description')}</h4>
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


