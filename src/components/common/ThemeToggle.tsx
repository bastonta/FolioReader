import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTranslation } from '../../i18n';

interface ThemeToggleProps {
  theme?: string;
  onToggle?: () => void;
  className?: string;
  tabIndex?: number;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({
  theme = 'light',
  onToggle,
  className = '',
  tabIndex,
}) => {
  const { t } = useTranslation();
  const isDark = theme === 'dark' || theme === 'gray';

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`auth-theme-toggle ${className}`}
      title={isDark ? t('theme.switchToLight') : t('theme.switchToDark')}
      tabIndex={tabIndex}
    >
      {isDark ? (
        <>
          <Sun size={16} className="theme-toggle-sun" />
          <span className="theme-toggle-label">{t('theme.lightMode')}</span>
        </>
      ) : (
        <>
          <Moon size={16} className="theme-toggle-moon" />
          <span className="theme-toggle-label">{t('theme.darkMode')}</span>
        </>
      )}
    </button>
  );
};

export default ThemeToggle;
