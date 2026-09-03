import { TranslationKey, TranslationParams } from '../i18n/types';
import { DevicePageInfo } from './devicePaginator';
import { FooterDisplayMode } from '../types/reader';

export function formatDuration(
  totalSeconds: number,
  t: (key: TranslationKey, params?: TranslationParams) => string
): string {
  if (totalSeconds <= 0) return t('common.lessThanMinute');
  const minutes = Math.max(1, Math.round(totalSeconds / 60));
  if (minutes < 60) {
    return t('common.minutesShort', { count: minutes });
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  if (remainingMins === 0) {
    return t('common.hoursShort', { count: hours });
  }
  return t('common.hoursMinutesShort', { hours, minutes: remainingMins });
}

export function formatPageLocationText(
  info: DevicePageInfo,
  mode: FooterDisplayMode,
  secondsPerPage: number,
  t: (key: TranslationKey, params?: TranslationParams) => string
): string {
  if (mode === 'chapter_ttr') {
    const chapterPagesLeft = Math.max(0, info.totalChapterPages - info.chapterPage);
    const chapterTimeLeftStr = formatDuration(chapterPagesLeft * secondsPerPage, t);
    return `${t('reader.timeLeftChapter', { time: chapterTimeLeftStr })} (${info.percent}%)`;
  }
  if (mode === 'book_ttr') {
    const bookPagesLeft = Math.max(0, info.totalBookPages - info.bookPage);
    const bookTimeLeftStr = formatDuration(bookPagesLeft * secondsPerPage, t);
    return `${t('reader.timeLeftBook', { time: bookTimeLeftStr })} (${info.percent}%)`;
  }
  if (mode === 'percent') {
    const chapterPagesText = t('reader.chapterPages', {
      current: info.chapterPage,
      total: info.totalChapterPages,
    });
    return `${info.percent}% · ${chapterPagesText}`;
  }
  // Default: 'pages'
  const bookPagesText = t('reader.bookPages', {
    current: info.bookPage,
    total: info.totalBookPages,
  });
  const chapterPagesText = t('reader.chapterPages', {
    current: info.chapterPage,
    total: info.totalChapterPages,
  });
  return `${bookPagesText} (${info.percent}%) · ${chapterPagesText}`;
}

export interface DeviceDisplayInfo {
  label: string;
  shortLabel: string;
  badgeClass: string;
  barColor: string;
  textColor: string;
  borderColor: string;
}

export function formatReadingSpeed(
  secondsPerPage?: number | null,
  t?: (key: TranslationKey, params?: TranslationParams) => string
): string {
  if (!secondsPerPage || secondsPerPage <= 0) {
    return '—';
  }

  if (secondsPerPage < 60) {
    const sec = Math.round(secondsPerPage);
    return t ? t('reader.secondsPerPage', { sec }) : `${sec}s / page`;
  }

  const mins = (secondsPerPage / 60).toFixed(1);
  return t ? t('reader.minutesPerPage', { min: mins }) : `${mins}m / page`;
}

export function getDeviceDisplayInfo(rawDeviceName?: string | null): DeviceDisplayInfo {
  const name = (rawDeviceName || '').trim();
  const lower = name.toLowerCase();

  if (
    lower.includes('koreader') ||
    lower.includes('foliosync') ||
    lower.includes('kobo') ||
    lower.includes('kindle')
  ) {
    return {
      label: 'FolioSync (KOReader)',
      shortLabel: 'FolioSync',
      badgeClass: 'badge-device-emerald',
      barColor: '#10b981',
      textColor: 'var(--success-color, #10b981)',
      borderColor: 'rgba(16, 185, 129, 0.3)',
    };
  }

  if (
    lower.includes('folioreader') ||
    lower.includes('desktop') ||
    lower.includes('mobile') ||
    lower.includes('android') ||
    lower.includes('ios')
  ) {
    return {
      label: 'FolioReader',
      shortLabel: 'FolioReader',
      badgeClass: 'badge-device-blue',
      barColor: '#3b82f6',
      textColor: 'var(--accent-color, #3b82f6)',
      borderColor: 'rgba(59, 130, 246, 0.3)',
    };
  }

  if (lower.includes('web') || lower.includes('browser')) {
    return {
      label: 'Folio Web',
      shortLabel: 'Web',
      badgeClass: 'badge-device-purple',
      barColor: '#a855f7',
      textColor: '#a855f7',
      borderColor: 'rgba(168, 85, 247, 0.3)',
    };
  }

  return {
    label: name || 'Other Device',
    shortLabel: name || 'Other',
    badgeClass: 'badge-device-amber',
    barColor: '#f59e0b',
    textColor: '#f59e0b',
    borderColor: 'rgba(245, 158, 11, 0.3)',
  };
}

export function formatDateOnly(dateInput?: string | Date | null, locale?: string): string {
  if (!dateInput) return '—';
  if (dateInput instanceof Date) {
    return isNaN(dateInput.getTime()) ? '—' : dateInput.toLocaleDateString(locale);
  }

  let str = String(dateInput).trim().replace(/(\.\d{3})\d+/, '$1');
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  const d2 = new Date(str.replace(' ', 'T'));
  if (!isNaN(d2.getTime())) {
    return d2.toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  return str;
}

export function formatDate(dateInput?: string | Date | null, locale?: string): string {
  if (!dateInput) return '—';
  if (dateInput instanceof Date) {
    return isNaN(dateInput.getTime()) ? '—' : dateInput.toLocaleString(locale);
  }

  let str = String(dateInput).trim().replace(/(\.\d{3})\d+/, '$1');
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d.toLocaleString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  const d2 = new Date(str.replace(' ', 'T'));
  if (!isNaN(d2.getTime())) {
    return d2.toLocaleString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return str;
}
