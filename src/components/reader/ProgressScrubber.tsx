import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from '../../i18n';

interface ProgressScrubberProps {
  fraction: number; // 0 to 1
  locationLabel?: string;
  onSeek: (fraction: number) => void;
  onPrev: () => void;
  onNext: () => void;
  sectionFractions: number[];
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export const ProgressScrubber: React.FC<ProgressScrubberProps> = ({
  fraction,
  locationLabel,
  onSeek,
  onPrev,
  onNext,
  sectionFractions,
  onMouseEnter,
  onMouseLeave,
}) => {
  const { t } = useTranslation();
  const percent = Math.round(fraction * 100);

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
        title={t('reader.prevPage')}
        aria-label={t('reader.prevPage')}
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
            value={isNaN(fraction) ? 0 : fraction}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            className="footer-progress-slider"
            list="chapter-ticks"
            title={`${percent}% · ${locationLabel || ''}`}
          />
          <datalist id="chapter-ticks">
            {sectionFractions.map((f, i) => (
              <option key={i} value={f} />
            ))}
          </datalist>
        </div>

        <div className="footer-info-row">
          <span className="footer-location-text">
            {locationLabel ? `${locationLabel} (${percent}%)` : `${percent}%`}
          </span>
        </div>
      </div>

      <button
        type="button"
        className="footer-nav-btn footer-nav-next"
        onClick={onNext}
        title={t('reader.nextPage')}
        aria-label={t('reader.nextPage')}
      >
        <ChevronRight size={18} />
      </button>
    </footer>
  );
};

