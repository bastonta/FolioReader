import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  X,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCw,
  Download,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  Contrast,
} from 'lucide-react';
import { useTranslation } from '../../i18n';

export interface ViewerImageItem {
  src: string;
  alt?: string;
  caption?: string;
  naturalWidth?: number;
  naturalHeight?: number;
}

export interface ImageViewerData extends ViewerImageItem {
  allImages?: ViewerImageItem[];
  currentIndex?: number;
}

interface ImageViewerModalProps {
  imageData: ImageViewerData | null;
  bookTitle?: string;
  onClose: () => void;
}

export const ImageViewerModal: React.FC<ImageViewerModalProps> = ({
  imageData,
  bookTitle,
  onClose,
}) => {
  const { t } = useTranslation();

  const imagesList = useMemo<ViewerImageItem[]>(() => {
    if (!imageData) return [];
    if (imageData.allImages && imageData.allImages.length > 0) {
      return imageData.allImages;
    }
    return [
      {
        src: imageData.src,
        alt: imageData.alt,
        caption: imageData.caption,
        naturalWidth: imageData.naturalWidth,
        naturalHeight: imageData.naturalHeight,
      },
    ];
  }, [imageData]);

  const [currentIdx, setCurrentIdx] = useState<number>(() => imageData?.currentIndex ?? 0);

  // Sync index if prop changes
  useEffect(() => {
    if (imageData?.currentIndex !== undefined) {
      setCurrentIdx(imageData.currentIndex);
    }
  }, [imageData?.currentIndex]);

  const currentItem = imagesList[currentIdx] || imageData;

  const [scale, setScale] = useState<number>(1);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [rotation, setRotation] = useState<number>(0);
  const [bgMode, setBgMode] = useState<'light' | 'invert' | 'dark'>('light');
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isPinching, setIsPinching] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [imgLoadedSize, setImgLoadedSize] = useState<{ width: number; height: number } | null>(null);

  const [showControls, setShowControls] = useState<boolean>(true);
  const showControlsRef = useRef<boolean>(true);
  showControlsRef.current = showControls;

  const isHoveringControlsRef = useRef<boolean>(false);
  const autoHideTimerRef = useRef<number | null>(null);

  const cancelAutoHide = useCallback(() => {
    if (autoHideTimerRef.current) {
      clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = null;
    }
  }, []);

  const scheduleAutoHide = useCallback(() => {
    cancelAutoHide();
    autoHideTimerRef.current = window.setTimeout(() => {
      if (!isHoveringControlsRef.current) {
        setShowControls(false);
      }
    }, 3500);
  }, [cancelAutoHide]);

  useEffect(() => {
    if (showControls) {
      scheduleAutoHide();
    } else {
      cancelAutoHide();
    }
    return () => cancelAutoHide();
  }, [showControls, scheduleAutoHide, cancelAutoHide]);

  const handleActivity = useCallback(() => {
    if (!showControlsRef.current) {
      setShowControls(true);
    }
    scheduleAutoHide();
  }, [scheduleAutoHide]);

  const handleToggleBg = useCallback(() => {
    handleActivity();
    setBgMode((m) => (m === 'light' ? 'invert' : m === 'invert' ? 'dark' : 'light'));
  }, [handleActivity]);

  const pointerDownTarget = useRef<EventTarget | null>(null);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const activePointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const dragStartPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const initialImagePos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const initialPinchDistance = useRef<number>(0);
  const initialPinchScale = useRef<number>(1);
  const hasMovedSignificantly = useRef<boolean>(false);

  // Reset zoom & transform when navigating to another image
  const resetTransform = useCallback(() => {
    handleActivity();
    setScale(1);
    setPosition({ x: 0, y: 0 });
    setRotation(0);
  }, [handleActivity]);

  const handlePrev = useCallback(() => {
    handleActivity();
    if (currentIdx > 0) {
      setCurrentIdx((prev) => prev - 1);
      resetTransform();
    }
  }, [currentIdx, resetTransform, handleActivity]);

  const handleNext = useCallback(() => {
    handleActivity();
    if (currentIdx < imagesList.length - 1) {
      setCurrentIdx((prev) => prev + 1);
      resetTransform();
    }
  }, [currentIdx, imagesList.length, resetTransform, handleActivity]);

  const handleZoomIn = useCallback(() => {
    handleActivity();
    setScale((s) => Math.min(10, Math.round(s * 1.3 * 100) / 100));
  }, [handleActivity]);

  const handleZoomOut = useCallback(() => {
    handleActivity();
    setScale((s) => {
      const next = Math.max(0.3, Math.round((s / 1.3) * 100) / 100);
      if (next <= 1) {
        setPosition({ x: 0, y: 0 });
      }
      return next;
    });
  }, [handleActivity]);

  const handleRotate = useCallback(() => {
    handleActivity();
    setRotation((r) => (r + 90) % 360);
  }, [handleActivity]);

  // Keyboard navigation
  useEffect(() => {
    if (!imageData) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      handleActivity();
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === '+' || e.key === '=') {
        handleZoomIn();
      } else if (e.key === '-' || e.key === '_') {
        handleZoomOut();
      } else if (e.key === '0') {
        resetTransform();
      } else if (e.key === 'r' || e.key === 'R') {
        handleRotate();
      } else if (e.key === 'i' || e.key === 'I' || e.key === 'c' || e.key === 'C') {
        handleToggleBg();
      } else if (e.key === 'ArrowLeft') {
        if (scale > 1.05) {
          setPosition((p) => ({ ...p, x: p.x + 60 }));
        } else {
          handlePrev();
        }
      } else if (e.key === 'ArrowRight') {
        if (scale > 1.05) {
          setPosition((p) => ({ ...p, x: p.x - 60 }));
        } else {
          handleNext();
        }
      } else if (e.key === 'ArrowUp' && scale > 1.05) {
        setPosition((p) => ({ ...p, y: p.y + 60 }));
      } else if (e.key === 'ArrowDown' && scale > 1.05) {
        setPosition((p) => ({ ...p, y: p.y - 60 }));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [imageData, scale, handleNext, handlePrev, handleZoomIn, handleZoomOut, handleRotate, handleToggleBg, handleActivity, resetTransform, onClose]);

  // Mouse wheel zoom towards pointer
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleActivity();

    const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newScale = Math.min(10, Math.max(0.3, scale * zoomFactor));
    if (Math.abs(newScale - scale) < 0.001) return;

    const container = imageContainerRef.current;
    if (!container) {
      setScale(newScale);
      return;
    }

    const rect = container.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const dx = e.clientX - (cx + position.x);
    const dy = e.clientY - (cy + position.y);
    const ratio = newScale / scale;

    setScale(newScale);
    if (newScale <= 1) {
      setPosition({ x: 0, y: 0 });
    } else {
      setPosition({
        x: position.x - dx * (ratio - 1),
        y: position.y - dy * (ratio - 1),
      });
    }
  };

  // Pointer drag & pinch handling
  const handlePointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    hasMovedSignificantly.current = false;
    pointerDownTarget.current = e.target;
    cancelAutoHide();

    if (activePointers.current.size === 1) {
      setIsDragging(true);
      dragStartPos.current = { x: e.clientX, y: e.clientY };
      initialImagePos.current = { ...position };
    } else if (activePointers.current.size === 2) {
      setIsDragging(false);
      setIsPinching(true);
      const pts = Array.from(activePointers.current.values());
      initialPinchDistance.current = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      initialPinchScale.current = scale;
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!activePointers.current.has(e.pointerId)) return;
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointers.current.size === 1 && isDragging) {
      const dx = e.clientX - dragStartPos.current.x;
      const dy = e.clientY - dragStartPos.current.y;
      if (Math.hypot(dx, dy) > 5) {
        hasMovedSignificantly.current = true;
      }
      setPosition({
        x: initialImagePos.current.x + dx,
        y: initialImagePos.current.y + dy,
      });
    } else if (activePointers.current.size === 2 && isPinching) {
      hasMovedSignificantly.current = true;
      const pts = Array.from(activePointers.current.values());
      const currentDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (initialPinchDistance.current > 0) {
        const factor = currentDist / initialPinchDistance.current;
        const newScale = Math.min(10, Math.max(0.3, initialPinchScale.current * factor));
        setScale(newScale);
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    activePointers.current.delete(e.pointerId);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {}

    if (activePointers.current.size < 2) {
      setIsPinching(false);
    }
    if (activePointers.current.size === 0) {
      setIsDragging(false);
      if (scale <= 1) {
        setPosition({ x: 0, y: 0 });
      }

      if (!hasMovedSignificantly.current) {
        if (!showControlsRef.current) {
          setShowControls(true);
          scheduleAutoHide();
        } else {
          const isBackdropClick = pointerDownTarget.current === imageContainerRef.current;
          if (isBackdropClick) {
            onClose();
          } else {
            setShowControls(false);
            cancelAutoHide();
          }
        }
      } else {
        if (showControlsRef.current) {
          scheduleAutoHide();
        }
      }
    }
  };

  // Double click to toggle between fit and 2.5x
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleActivity();

    if (scale <= 1.05) {
      const container = imageContainerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        setScale(2.5);
        setPosition({ x: -dx * 1.5, y: -dy * 1.5 });
      } else {
        setScale(2.5);
      }
    } else {
      resetTransform();
    }
  };

  // Click backdrop outside image: reveal controls if hidden, close if already shown
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !hasMovedSignificantly.current) {
      if (!showControlsRef.current) {
        setShowControls(true);
        scheduleAutoHide();
      } else {
        onClose();
      }
    }
  };

  // Download image
  const handleDownload = () => {
    handleActivity();
    if (!currentItem?.src) return;
    try {
      const link = document.createElement('a');
      link.href = currentItem.src;
      const cleanBookTitle = (bookTitle || 'folio')
        .replace(/[/\\?%*:|"<>]/g, '_')
        .slice(0, 30);
      const isSvg = currentItem.src.startsWith('data:image/svg') || currentItem.src.includes('.svg');
      const ext = isSvg ? 'svg' : 'png';
      link.download = `${cleanBookTitle}_image_${currentIdx + 1}.${ext}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.warn('Failed to download image:', err);
    }
  };

  // Copy image to clipboard
  const handleCopy = async () => {
    handleActivity();
    if (!currentItem?.src) return;
    try {
      const res = await fetch(currentItem.src);
      const blob = await res.blob();

      if (blob.type === 'image/png' && window.ClipboardItem && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      } else {
        // Convert to PNG canvas for universal clipboard support
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = currentItem.src;
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
          if (pngBlob && window.ClipboardItem && navigator.clipboard?.write) {
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
          }
        }
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Failed to copy image to clipboard:', err);
    }
  };

  if (!imageData || !currentItem) return null;

  const totalImages = imagesList.length;
  const hasMultiple = totalImages > 1;
  const captionText = currentItem.caption || currentItem.alt || '';
  const displayResolution = imgLoadedSize
    ? `${imgLoadedSize.width} × ${imgLoadedSize.height} px`
    : currentItem.naturalWidth && currentItem.naturalHeight
    ? `${currentItem.naturalWidth} × ${currentItem.naturalHeight} px`
    : null;

  return (
    <div
      className="image-viewer-backdrop"
      onClick={handleBackdropClick}
      onMouseMove={handleActivity}
      onWheel={handleWheel}
      role="dialog"
      aria-label={t('reader.imageViewer')}
      aria-modal="true"
    >
      {/* Top Bar */}
      <div
        className={`image-viewer-top-bar ${!showControls ? 'is-hidden' : ''}`}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleActivity}
        onMouseEnter={() => {
          isHoveringControlsRef.current = true;
          cancelAutoHide();
        }}
        onMouseLeave={() => {
          isHoveringControlsRef.current = false;
          if (showControlsRef.current) scheduleAutoHide();
        }}
      >
        <div className="image-viewer-title-info">
          {hasMultiple && (
            <span className="image-viewer-counter">
              {t('reader.imageCounter', { current: currentIdx + 1, total: totalImages })}
            </span>
          )}
          {captionText && (
            <span className="image-viewer-caption" title={captionText}>
              {captionText}
            </span>
          )}
          {displayResolution && (
            <span className="image-viewer-resolution">{displayResolution}</span>
          )}
        </div>

        <div className="image-viewer-top-actions">
          <button
            type="button"
            className={`image-viewer-btn ${copied ? 'image-viewer-btn-success' : ''}`}
            onClick={handleCopy}
            title={copied ? t('reader.imageCopied') : t('reader.copyImage')}
            aria-label={t('reader.copyImage')}
          >
            {copied ? <Check size={17} /> : <Copy size={17} />}
          </button>
          <button
            type="button"
            className="image-viewer-btn"
            onClick={handleDownload}
            title={t('reader.downloadImage')}
            aria-label={t('reader.downloadImage')}
          >
            <Download size={17} />
          </button>
          <button
            type="button"
            className="image-viewer-btn image-viewer-close-btn"
            onClick={onClose}
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Navigation Arrows for multi-image chapters */}
      {hasMultiple && (
        <>
          <button
            type="button"
            className={`image-viewer-nav-btn image-viewer-prev-btn ${currentIdx === 0 ? 'image-viewer-nav-disabled' : ''} ${!showControls ? 'is-hidden' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              handlePrev();
            }}
            onTouchStart={handleActivity}
            onMouseEnter={() => {
              isHoveringControlsRef.current = true;
              cancelAutoHide();
            }}
            onMouseLeave={() => {
              isHoveringControlsRef.current = false;
              if (showControlsRef.current) scheduleAutoHide();
            }}
            disabled={currentIdx === 0}
            title={t('reader.prevImage')}
            aria-label={t('reader.prevImage')}
          >
            <ChevronLeft size={28} />
          </button>
          <button
            type="button"
            className={`image-viewer-nav-btn image-viewer-next-btn ${currentIdx === totalImages - 1 ? 'image-viewer-nav-disabled' : ''} ${!showControls ? 'is-hidden' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            onTouchStart={handleActivity}
            onMouseEnter={() => {
              isHoveringControlsRef.current = true;
              cancelAutoHide();
            }}
            onMouseLeave={() => {
              isHoveringControlsRef.current = false;
              if (showControlsRef.current) scheduleAutoHide();
            }}
            disabled={currentIdx === totalImages - 1}
            title={t('reader.nextImage')}
            aria-label={t('reader.nextImage')}
          >
            <ChevronRight size={28} />
          </button>
        </>
      )}

      {/* Main Image Stage */}
      <div
        ref={imageContainerRef}
        className={`image-viewer-stage ${isDragging ? 'is-dragging' : ''} ${scale > 1.05 ? 'is-zoomable' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        <img
          src={currentItem.src}
          alt={currentItem.alt || ''}
          className={`image-viewer-img image-viewer-bg-${bgMode}`}
          style={{
            transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${scale}) rotate(${rotation}deg)`,
            transition: isDragging || isPinching ? 'none' : 'transform 0.18s cubic-bezier(0.2, 0, 0, 1)',
            backgroundColor: bgMode === 'dark' ? 'transparent' : '#ffffff',
            filter: bgMode === 'invert' ? 'invert(1) hue-rotate(180deg)' : 'none',
          }}
          draggable={false}
          onLoad={(e) => {
            const target = e.currentTarget;
            setImgLoadedSize({ width: target.naturalWidth, height: target.naturalHeight });
          }}
        />
      </div>

      {/* Bottom Floating Toolbar */}
      <div
        className={`image-viewer-bottom-bar ${!showControls ? 'is-hidden' : ''}`}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleActivity}
        onMouseEnter={() => {
          isHoveringControlsRef.current = true;
          cancelAutoHide();
        }}
        onMouseLeave={() => {
          isHoveringControlsRef.current = false;
          if (showControlsRef.current) scheduleAutoHide();
        }}
      >
        <button
          type="button"
          className="image-viewer-tool-btn"
          onClick={handleZoomOut}
          title={t('reader.zoomOut')}
          aria-label={t('reader.zoomOut')}
        >
          <ZoomOut size={18} />
        </button>

        <button
          type="button"
          className="image-viewer-scale-pill"
          onClick={resetTransform}
          title={t('reader.resetZoom')}
          aria-label={t('reader.resetZoom')}
        >
          {Math.round(scale * 100)}%
        </button>

        <button
          type="button"
          className="image-viewer-tool-btn"
          onClick={handleZoomIn}
          title={t('reader.zoomIn')}
          aria-label={t('reader.zoomIn')}
        >
          <ZoomIn size={18} />
        </button>

        <div className="image-viewer-toolbar-divider" />

        <button
          type="button"
          className="image-viewer-tool-btn"
          onClick={resetTransform}
          title={t('reader.fitToScreen')}
          aria-label={t('reader.fitToScreen')}
        >
          <Maximize2 size={17} />
        </button>

        <button
          type="button"
          className="image-viewer-tool-btn"
          onClick={handleRotate}
          title={t('reader.rotateClockwise')}
          aria-label={t('reader.rotateClockwise')}
        >
          <RotateCw size={17} />
        </button>

        <button
          type="button"
          className={`image-viewer-tool-btn ${bgMode !== 'light' ? 'image-viewer-tool-active' : ''}`}
          onClick={handleToggleBg}
          title={
            bgMode === 'light'
              ? t('reader.imageBgLight')
              : bgMode === 'invert'
              ? t('reader.imageBgInvert')
              : t('reader.imageBgDark')
          }
          aria-label={t('reader.toggleImageBackground')}
        >
          <Contrast size={17} />
        </button>
      </div>
    </div>
  );
};
