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
