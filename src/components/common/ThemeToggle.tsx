import React from 'react';
import { Sun, Moon } from 'lucide-react';

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
  const isDark = theme === 'dark' || theme === 'gray';

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`auth-theme-toggle ${className}`}
      title={isDark ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
      tabIndex={tabIndex}
    >
      {isDark ? (
        <>
          <Sun size={16} className="theme-toggle-sun" />
          <span className="theme-toggle-label">Light Mode</span>
        </>
      ) : (
        <>
          <Moon size={16} className="theme-toggle-moon" />
          <span className="theme-toggle-label">Dark Mode</span>
        </>
      )}
    </button>
  );
};

export default ThemeToggle;
