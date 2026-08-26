import React from 'react';
import { useTranslation } from '../../i18n';

export interface SplashScreenProps {
  theme?: string;
  message?: string;
  showSpinner?: boolean;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({
  theme = 'light',
  message,
  showSpinner = true,
}) => {
  const { t } = useTranslation();

  return (
    <div className={`android-splash-container theme-${theme}`} aria-label={t('common.loading')}>
      <div className="android-splash-center">
        <div className="android-splash-icon-wrapper">
          <img
            src="/icon.png"
            alt={t('common.appName')}
            className="android-splash-icon"
            draggable={false}
          />
        </div>

        {showSpinner && (
          <div className="android-splash-spinner-wrapper" aria-hidden="true">
            <svg className="android-splash-spinner" viewBox="0 0 48 48">
              <circle
                className="android-splash-spinner-track"
                cx="24"
                cy="24"
                r="18"
                fill="none"
                strokeWidth="3.5"
              />
              <circle
                className="android-splash-spinner-head"
                cx="24"
                cy="24"
                r="18"
                fill="none"
                strokeWidth="3.5"
              />
            </svg>
          </div>
        )}

        {message && <p className="android-splash-message">{message}</p>}
      </div>

      <div className="android-splash-footer">
        <span className="android-splash-title">{t('common.appName')}</span>
        <span className="android-splash-subtitle">{t('common.appSubtitle')}</span>
      </div>
    </div>
  );
};

export default SplashScreen;
