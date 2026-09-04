import { ChevronLeft, ChevronRight } from "lucide-react";
import React from "react";
import { useTranslation } from "../../i18n";

import { DevicePageInfo } from "../../services/devicePaginator";
import { formatDuration } from "../../services/timeFormat";
import { FooterDisplayMode } from "../../types/reader";

export type { FooterDisplayMode } from "../../types/reader";

interface ProgressScrubberProps {
  fraction: number; // 0 to 1
  pageInfo?: DevicePageInfo | null;
  locationLabel?: string;
  onSeek: (fraction: number) => void;
  onPrev: () => void;
  onNext: () => void;
  sectionFractions: number[];
  averageSecondsPerPage?: number;
  displayMode?: FooterDisplayMode;
  onDisplayModeChange?: (mode: FooterDisplayMode) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export const ProgressScrubber: React.FC<ProgressScrubberProps> = ({
  fraction,
  pageInfo,
  locationLabel,
  onSeek,
  onPrev,
  onNext,
  sectionFractions,
  averageSecondsPerPage,
  displayMode = "pages",
  onDisplayModeChange,
  onMouseEnter,
  onMouseLeave,
}) => {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = React.useState(false);
  const [dragFraction, setDragFraction] = React.useState<number | null>(null);

  const isDraggingRef = React.useRef(false);
  const dragFractionRef = React.useRef<number | null>(null);
  isDraggingRef.current = isDragging;
  dragFractionRef.current = dragFraction;

  const effectiveFraction = isDragging && dragFraction !== null ? dragFraction : fraction;
  const percent = Math.round((effectiveFraction || 0) * 100);

  const commitSeek = React.useCallback(
    (targetFraction: number) => {
      setIsDragging(false);
      setDragFraction(null);
      onSeek(targetFraction);
    },
    [onSeek]
  );

  React.useEffect(() => {
    const handleGlobalPointerUp = () => {
      if (isDraggingRef.current && dragFractionRef.current !== null) {
        commitSeek(dragFractionRef.current);
      }
    };

    window.addEventListener("pointerup", handleGlobalPointerUp);
    window.addEventListener("touchend", handleGlobalPointerUp);
    return () => {
      window.removeEventListener("pointerup", handleGlobalPointerUp);
      window.removeEventListener("touchend", handleGlobalPointerUp);
    };
  }, [commitSeek]);

  const secondsPerPage =
    averageSecondsPerPage && averageSecondsPerPage > 0
      ? averageSecondsPerPage
      : 60;

  const chapterPagesLeft = pageInfo
    ? Math.max(0, pageInfo.totalChapterPages - pageInfo.chapterPage)
    : 0;
  const bookPagesLeft = pageInfo
    ? Math.max(0, pageInfo.totalBookPages - pageInfo.bookPage)
    : 0;

  const chapterTimeLeftStr = formatDuration(
    chapterPagesLeft * secondsPerPage,
    t,
  );
  const bookTimeLeftStr = formatDuration(bookPagesLeft * secondsPerPage, t);

  const cycleDisplayMode = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextMode: FooterDisplayMode = (() => {
      if (displayMode === "pages") return "chapter_ttr";
      if (displayMode === "chapter_ttr") return "book_ttr";
      if (displayMode === "book_ttr") return "percent";
      return "pages";
    })();
    onDisplayModeChange?.(nextMode);
  };

  const tooltipTitle = pageInfo
    ? `${t("reader.bookPages", { current: pageInfo.bookPage, total: pageInfo.totalBookPages })} (${isDragging ? percent : pageInfo.percent}%) · ${t("reader.chapterPages", { current: pageInfo.chapterPage, total: pageInfo.totalChapterPages })}`
    : `${percent}% · ${locationLabel || ""}`;

  return (
    <footer
      className="reader-footer-bar"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <button
        type="button"
        className="footer-nav-btn footer-nav-prev"
        onClick={onPrev}
        title={t("reader.prevPage")}
        aria-label={t("reader.prevPage")}
      >
        <ChevronLeft size={18} />
      </button>

      <div className="footer-scrubber-center">
        <div className="scrubber-slider-wrap">
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={isNaN(effectiveFraction) ? 0 : effectiveFraction}
            onPointerDown={() => {
              setIsDragging(true);
              setDragFraction(fraction);
            }}
            onTouchStart={() => {
              setIsDragging(true);
              setDragFraction(fraction);
            }}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (isDragging) {
                setDragFraction(val);
              } else {
                commitSeek(val);
              }
            }}
            onPointerUp={(e) => {
              if (isDragging && dragFraction !== null) {
                commitSeek(dragFraction);
              } else {
                commitSeek(parseFloat(e.currentTarget.value));
              }
            }}
            onTouchEnd={() => {
              if (isDraggingRef.current && dragFractionRef.current !== null) {
                commitSeek(dragFractionRef.current);
              }
            }}
            className="footer-progress-slider"
            list="chapter-ticks"
            title={tooltipTitle}
          />
          <datalist id="chapter-ticks">
            {sectionFractions.map((f, i) => (
              <option key={i} value={f} />
            ))}
          </datalist>
        </div>

        <div
          className="footer-info-row cursor-pointer select-none transition-opacity hover:opacity-80"
          onClick={cycleDisplayMode}
          title={t("reader.cycleDisplayModeTooltip")}
        >
          {pageInfo ? (
            <div className="footer-info-stats">
              {displayMode === "pages" && (
                <>
                  <span className="footer-book-page">
                    {t("reader.bookPages", {
                      current: pageInfo.bookPage,
                      total: pageInfo.totalBookPages,
                    })}
                    <span className="footer-percent">
                      {" "}
                      ({pageInfo.percent}%)
                    </span>
                  </span>
                  <span className="footer-info-divider">•</span>
                  <span className="footer-chapter-page">
                    {t("reader.chapterPages", {
                      current: pageInfo.chapterPage,
                      total: pageInfo.totalChapterPages,
                    })}
                  </span>
                </>
              )}

              {displayMode === "chapter_ttr" && (
                <span className="footer-ttr-chapter font-medium text-amber-500/90 dark:text-amber-400">
                  {t("reader.timeLeftChapter", { time: chapterTimeLeftStr })}
                  <span className="footer-percent text-xs text-muted-foreground ml-2">
                    ({pageInfo.percent}%)
                  </span>
                </span>
              )}

              {displayMode === "book_ttr" && (
                <span className="footer-ttr-book font-medium text-emerald-500/90 dark:text-emerald-400">
                  {t("reader.timeLeftBook", { time: bookTimeLeftStr })}
                  <span className="footer-percent text-xs text-muted-foreground ml-2">
                    ({pageInfo.percent}%)
                  </span>
                </span>
              )}

              {displayMode === "percent" && (
                <span className="footer-percent-only font-medium">
                  {pageInfo.percent}% ·{" "}
                  {t("reader.chapterPages", {
                    current: pageInfo.chapterPage,
                    total: pageInfo.totalChapterPages,
                  })}
                </span>
              )}
            </div>
          ) : (
            <span className="footer-location-text">
              {locationLabel ? `${locationLabel} (${percent}%)` : `${percent}%`}
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        className="footer-nav-btn footer-nav-next"
        onClick={onNext}
        title={t("reader.nextPage")}
        aria-label={t("reader.nextPage")}
      >
        <ChevronRight size={18} />
      </button>
    </footer>
  );
};
