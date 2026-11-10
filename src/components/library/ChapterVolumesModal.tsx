import React from 'react';
import { BookOpen, CheckCircle2, Download, Loader2, RefreshCw } from 'lucide-react';
import { Modal } from '../common/Modal';
import { useTranslation } from '../../i18n';
import { BookVolume, ChapterCopy } from '../../types/browse';

export interface ChapterVolumesModalProps {
  isOpen: boolean;
  bookTitle: string;
  /** Volumes of the book on the server, in reading order */
  volumes: BookVolume[];
  /** Copies of the book already on this device (the whole book and single volumes) */
  copies: ChapterCopy[];
  /** `null` stands for the whole book */
  isDownloading: (volume: number | null) => boolean;
  getDownloadingLabel: (volume: number | null) => string;
  /** Downloads a copy, or checks a downloaded one for new chapters */
  onDownload: (volume: number | null) => void;
  /** Opens a downloaded copy in the reader; the button is hidden when absent */
  onOpen?: (copy: ChapterCopy) => void;
  onClose: () => void;
}

const formatNumber = (value: number): string => String(Number(value.toFixed(3)));

// The shared button classes are sized for full-width forms
const actionButtonStyle: React.CSSProperties = {
  width: 'auto',
  height: 32,
  flexShrink: 0,
  padding: '0 12px',
  fontSize: 12,
  gap: 4,
  whiteSpace: 'nowrap',
  boxShadow: 'none',
};

interface VolumeRow {
  /** `null` for the whole book */
  volume: number | null;
  name: string;
  details: string;
  copy?: ChapterCopy;
}

/**
 * Lets the reader choose what to download of a `Chapters` book that has several volumes:
 * the whole book as one file, or single volumes — each a file of its own that is opened
 * and updated independently.
 */
export const ChapterVolumesModal: React.FC<ChapterVolumesModalProps> = ({
  isOpen,
  bookTitle,
  volumes,
  copies,
  isDownloading,
  getDownloadingLabel,
  onDownload,
  onOpen,
  onClose,
}) => {
  const { t } = useTranslation();

  const totalChapters = volumes.reduce((sum, v) => sum + v.chaptersCount, 0);
  const rows: VolumeRow[] = [
    {
      volume: null,
      name: t('browse.wholeBook'),
      details: t('browse.volumeChapters', { count: totalChapters }),
      copy: copies.find((c) => c.volume === null || c.volume === undefined),
    },
    ...volumes.map((v) => {
      const hasRange =
        typeof v.firstChapter === 'number' &&
        typeof v.lastChapter === 'number' &&
        v.firstChapter !== v.lastChapter;
      const count = t('browse.volumeChapters', { count: v.chaptersCount });
      return {
        volume: v.volume,
        name: t('browse.volumeName', { number: formatNumber(v.volume) }),
        details: hasRange
          ? `${count} · ${t('browse.volumeChapterRange', {
              first: formatNumber(v.firstChapter as number),
              last: formatNumber(v.lastChapter as number),
            })}`
          : count,
        copy: copies.find((c) => c.volume === v.volume),
      };
    }),
  ];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={bookTitle} maxWidth="520px">
      <p
        style={{
          margin: '0 0 12px 0',
          fontSize: 13,
          lineHeight: 1.45,
          color: 'var(--text-secondary)',
        }}
      >
        {t('browse.volumesIntro')}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((row) => {
          const busy = isDownloading(row.volume);
          const copy = row.copy;
          return (
            <div
              key={row.volume === null ? 'whole' : `v${row.volume}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--text-primary)',
                  }}
                >
                  <span>{row.name}</span>
                  {copy && (
                    <span
                      title={t('browse.downloaded')}
                      aria-label={t('browse.downloaded')}
                      style={{ display: 'inline-flex', color: '#22c55e' }}
                    >
                      <CheckCircle2 size={14} />
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {busy ? getDownloadingLabel(row.volume) : row.details}
                </div>
              </div>

              {copy ? (
                <>
                  <button
                    type="button"
                    className="auth-btn-secondary"
                    style={{ ...actionButtonStyle, padding: '0 9px' }}
                    onClick={() => onDownload(row.volume)}
                    disabled={busy}
                    title={t('browse.updateChapters')}
                    aria-label={t('browse.updateChapters')}
                  >
                    {busy ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <RefreshCw size={13} />
                    )}
                  </button>
                  {onOpen && (
                    <button
                      type="button"
                      className="auth-btn-primary"
                      style={actionButtonStyle}
                      onClick={() => onOpen(copy)}
                      disabled={busy}
                    >
                      <BookOpen size={13} />
                      <span>{t('browse.read')}</span>
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  className="auth-btn-primary"
                  style={actionButtonStyle}
                  onClick={() => onDownload(row.volume)}
                  disabled={busy}
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                  <span>{t('browse.download')}</span>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
};
