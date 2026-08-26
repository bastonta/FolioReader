import React, {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useId,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption<T = string> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
  style?: React.CSSProperties;
  className?: string;
  icon?: React.ReactNode;
  subtext?: string;
}

export interface SelectOptionGroup<T = string> {
  label: string;
  options: SelectOption<T>[];
}

export interface SelectProps<T = string> {
  value: T;
  onChange: (value: T) => void;
  options?: SelectOption<T>[];
  groups?: SelectOptionGroup<T>[];
  placeholder?: string;
  disabled?: boolean;
  icon?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  triggerClassName?: string;
  triggerStyle?: React.CSSProperties;
  menuClassName?: string;
  menuStyle?: React.CSSProperties;
  placement?: 'auto' | 'bottom' | 'top';
  dropdownMatchWidth?: boolean;
  minMenuWidth?: number;
  maxMenuHeight?: number;
  size?: 'sm' | 'md' | 'lg';
  id?: string;
  'aria-label'?: string;
}

interface FlattenedOption<T> {
  option: SelectOption<T>;
  groupLabel?: string;
  index: number;
}

export function Select<T extends string | number = string>({
  value,
  onChange,
  options,
  groups,
  placeholder,
  disabled = false,
  icon,
  className = '',
  style,
  triggerClassName = '',
  triggerStyle,
  menuClassName = '',
  menuStyle,
  placement = 'auto',
  dropdownMatchWidth = true,
  minMenuWidth = 140,
  maxMenuHeight = 300,
  size = 'md',
  id,
  'aria-label': ariaLabel,
}: SelectProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
    isUpwards: boolean;
  }>({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: maxMenuHeight,
    isUpwards: false,
  });

  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const generatedId = useId();
  const selectId = id || generatedId;

  // Flatten options for easy index navigation & lookup
  const flattenedOptions: FlattenedOption<T>[] = React.useMemo(() => {
    let result: FlattenedOption<T>[] = [];
    let idx = 0;

    if (groups && groups.length > 0) {
      groups.forEach((g) => {
        g.options.forEach((opt) => {
          result.push({
            option: opt,
            groupLabel: g.label,
            index: idx++,
          });
        });
      });
    } else if (options && options.length > 0) {
      options.forEach((opt) => {
        result.push({
          option: opt,
          index: idx++,
        });
      });
    }

    return result;
  }, [options, groups]);

  // Find currently selected option
  const selectedItem = flattenedOptions.find(
    (item) => item.option.value === value
  )?.option;

  // Position calculation
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const padding = 8;

    const width = dropdownMatchWidth
      ? Math.max(rect.width, minMenuWidth)
      : minMenuWidth;

    let left = rect.left;
    if (left + width > viewportWidth - padding) {
      left = Math.max(padding, viewportWidth - width - padding);
    }
    if (left < padding) {
      left = padding;
    }

    const spaceBelow = viewportHeight - rect.bottom - padding;
    const spaceAbove = rect.top - padding;

    let isUpwards = false;
    let maxHeight = maxMenuHeight;

    if (placement === 'top') {
      isUpwards = true;
      maxHeight = Math.min(maxMenuHeight, Math.max(spaceAbove - 6, 120));
    } else if (placement === 'bottom') {
      isUpwards = false;
      maxHeight = Math.min(maxMenuHeight, Math.max(spaceBelow - 6, 120));
    } else {
      // auto
      if (spaceBelow < 180 && spaceAbove > spaceBelow) {
        isUpwards = true;
        maxHeight = Math.min(maxMenuHeight, Math.max(spaceAbove - 6, 120));
      } else {
        isUpwards = false;
        maxHeight = Math.min(maxMenuHeight, Math.max(spaceBelow - 6, 120));
      }
    }

    let top = isUpwards ? rect.top - 4 : rect.bottom + 4;

    setMenuPosition({
      top,
      left,
      width,
      maxHeight,
      isUpwards,
    });
  }, [dropdownMatchWidth, minMenuWidth, maxMenuHeight, placement]);

  useLayoutEffect(() => {
    if (isOpen) {
      updatePosition();
    }
  }, [isOpen, updatePosition]);

  // Sync highlighted index when opening
  useEffect(() => {
    if (isOpen) {
      const selectedIndex = flattenedOptions.findIndex(
        (item) => item.option.value === value
      );
      setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0);
    }
  }, [isOpen, value, flattenedOptions]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && highlightedIndex >= 0) {
      const el = optionRefs.current[highlightedIndex];
      if (el) {
        el.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [isOpen, highlightedIndex]);

  // Click outside and scroll/resize listeners
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDownOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        menuRef.current &&
        !menuRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    const handleScrollOrResize = () => {
      if (triggerRef.current) {
        updatePosition();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDownOutside, true);
    document.addEventListener('touchstart', handlePointerDownOutside, true);
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDownOutside, true);
      document.removeEventListener('touchstart', handlePointerDownOutside, true);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, updatePosition]);

  // Keyboard navigation on trigger and list
  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      } else {
        if (e.key === 'ArrowDown') {
          setHighlightedIndex((prev) => {
            let next = prev + 1;
            while (next < flattenedOptions.length && flattenedOptions[next].option.disabled) {
              next++;
            }
            return next < flattenedOptions.length ? next : prev;
          });
        } else if (e.key === 'ArrowUp') {
          setHighlightedIndex((prev) => {
            let prevIdx = prev - 1;
            while (prevIdx >= 0 && flattenedOptions[prevIdx].option.disabled) {
              prevIdx--;
            }
            return prevIdx >= 0 ? prevIdx : prev;
          });
        } else if (e.key === 'Enter' || e.key === ' ') {
          if (highlightedIndex >= 0 && highlightedIndex < flattenedOptions.length) {
            const item = flattenedOptions[highlightedIndex];
            if (!item.option.disabled) {
              onChange(item.option.value);
              setIsOpen(false);
            }
          }
        }
      }
    } else if (e.key === 'Tab' && isOpen) {
      setIsOpen(false);
    }
  };

  const handleSelect = (val: T, optDisabled?: boolean) => {
    if (optDisabled) return;
    onChange(val);
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const sizeClass = size === 'sm' ? 'select-sm' : size === 'lg' ? 'select-lg' : 'select-md';

  const menuDropdown = isOpen && (
    <div
      ref={menuRef}
      id={`${selectId}-menu`}
      className={`custom-select-menu ${menuPosition.isUpwards ? 'upwards' : 'downwards'} ${menuClassName}`}
      style={{
        position: 'fixed',
        top: menuPosition.isUpwards ? undefined : menuPosition.top,
        bottom: menuPosition.isUpwards ? window.innerHeight - menuPosition.top : undefined,
        left: menuPosition.left,
        width: dropdownMatchWidth ? menuPosition.width : undefined,
        minWidth: minMenuWidth,
        maxHeight: menuPosition.maxHeight,
        zIndex: 10005,
        ...menuStyle,
      }}
      role="listbox"
      aria-label={ariaLabel}
      tabIndex={-1}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="custom-select-options-scroller">
        {groups && groups.length > 0 ? (
          groups.map((group, gIdx) => (
            <div key={gIdx} className="custom-select-group" role="group" aria-label={group.label}>
              <div className="custom-select-group-header">{group.label}</div>
              {group.options.map((opt) => {
                const flatItem = flattenedOptions.find((item) => item.option.value === opt.value);
                const flatIndex = flatItem?.index ?? -1;
                const isSelected = opt.value === value;
                const isHighlighted = flatIndex === highlightedIndex;

                return (
                  <button
                    key={String(opt.value)}
                    ref={(el) => {
                      if (flatIndex >= 0) optionRefs.current[flatIndex] = el;
                    }}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    disabled={opt.disabled}
                    className={`custom-select-option ${isSelected ? 'selected' : ''} ${
                      isHighlighted ? 'highlighted' : ''
                    } ${opt.className || ''}`}
                    style={opt.style}
                    onClick={() => handleSelect(opt.value, opt.disabled)}
                    onMouseEnter={() => setHighlightedIndex(flatIndex)}
                  >
                    <div className="custom-select-option-content">
                      {opt.icon && <span className="custom-select-option-icon">{opt.icon}</span>}
                      <span className="custom-select-option-label">{opt.label}</span>
                      {opt.subtext && <span className="custom-select-option-subtext">{opt.subtext}</span>}
                    </div>
                    {isSelected && <Check size={15} className="custom-select-check-icon" />}
                  </button>
                );
              })}
            </div>
          ))
        ) : (
          flattenedOptions.map(({ option: opt, index }) => {
            const isSelected = opt.value === value;
            const isHighlighted = index === highlightedIndex;

            return (
              <button
                key={String(opt.value)}
                ref={(el) => {
                  optionRefs.current[index] = el;
                }}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={opt.disabled}
                className={`custom-select-option ${isSelected ? 'selected' : ''} ${
                  isHighlighted ? 'highlighted' : ''
                } ${opt.className || ''}`}
                style={opt.style}
                onClick={() => handleSelect(opt.value, opt.disabled)}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                <div className="custom-select-option-content">
                  {opt.icon && <span className="custom-select-option-icon">{opt.icon}</span>}
                  <span className="custom-select-option-label">{opt.label}</span>
                  {opt.subtext && <span className="custom-select-option-subtext">{opt.subtext}</span>}
                </div>
                {isSelected && <Check size={15} className="custom-select-check-icon" />}
              </button>
            );
          })
        )}
      </div>
    </div>
  );

  return (
    <div className={`custom-select-container ${sizeClass} ${disabled ? 'disabled' : ''} ${className}`} style={style}>
      <button
        ref={triggerRef}
        id={selectId}
        type="button"
        disabled={disabled}
        className={`custom-select-trigger ${isOpen ? 'open' : ''} ${triggerClassName}`}
        style={triggerStyle}
        onClick={() => {
          if (!disabled) {
            setIsOpen(!isOpen);
          }
        }}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={`${selectId}-menu`}
        aria-label={ariaLabel}
      >
        <div className="custom-select-trigger-content">
          {icon && <span className="custom-select-trigger-icon">{icon}</span>}
          {selectedItem?.icon && !icon && (
            <span className="custom-select-trigger-icon">{selectedItem.icon}</span>
          )}
          <span
            className="custom-select-trigger-label"
            style={selectedItem?.style}
          >
            {selectedItem ? selectedItem.label : placeholder || ''}
          </span>
        </div>

        <ChevronDown
          size={16}
          className={`custom-select-chevron ${isOpen ? 'rotated' : ''}`}
          aria-hidden="true"
        />
      </button>

      {typeof document !== 'undefined' && createPortal(menuDropdown, document.body)}
    </div>
  );
}
