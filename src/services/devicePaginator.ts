/**
 * DevicePaginator
 * 
 * Accurately calculates device screen page numbers for both the entire book
 * and the current chapter, adapting to the user's screen size, orientation,
 * font settings, margins, and column layout.
 */

export interface DevicePageInfo {
  bookPage: number;
  totalBookPages: number;
  chapterPage: number;
  totalChapterPages: number;
  percent: number;
  isEstimated: boolean;
  sectionIndex: number;
}

export interface PaginatorLayoutConfig {
  width: number;
  height: number;
  flow: 'paginated' | 'scrolled';
  columns: 'auto' | 1 | 2;
  fontSize: number;
  fontFamily: string;
  spacing: number;
  margin: number;
  readerCSS: string;
}

// In-memory cache for fast restoration across opens and chapter turns
const memoryPaginationCache = new Map<string, number[]>();

export class DevicePaginator {
  private book: any;
  private bookId: string;
  private layout: PaginatorLayoutConfig;
  private isFixedLayout: boolean;
  private sectionPages: number[] = [];
  private measuredSet: Set<number> = new Set();
  private abortController: AbortController | null = null;
  private isFullyPaginated = false;
  private bytesPerPage = 1800; // Default screen density heuristic (bytes per page)
  private onUpdateCallback?: (paginator: DevicePaginator) => void;
  private cacheKey: string;
  private offscreenIframe: HTMLIFrameElement | null = null;

  constructor(
    bookId: string,
    book: any,
    layout: PaginatorLayoutConfig,
    onUpdate?: (paginator: DevicePaginator) => void
  ) {
    this.bookId = bookId;
    this.book = book;
    this.layout = layout;
    this.onUpdateCallback = onUpdate;
    this.isFixedLayout = Boolean(
      book?.rendition?.layout === 'pre-paginated' ||
      book?.isPDF ||
      book?.isCBZ
    );

    this.cacheKey = `${bookId}_${Math.round(layout.width)}x${Math.round(layout.height)}_${layout.fontSize}_${layout.fontFamily}_${layout.spacing}_${layout.margin}_${layout.columns}_${layout.flow}`;

    this.init();
  }

  public getBookId(): string {
    return this.bookId;
  }

  private init() {
    const totalSections = this.book?.sections?.length || 0;
    if (totalSections === 0) {
      this.sectionPages = [1];
      this.isFullyPaginated = true;
      return;
    }

    if (this.isFixedLayout) {
      this.sectionPages = new Array(totalSections).fill(1);
      this.isFullyPaginated = true;
      for (let i = 0; i < totalSections; i++) {
        this.measuredSet.add(i);
      }
      return;
    }

    // Check in-memory cache for existing calculations with these exact layout parameters
    const cached = memoryPaginationCache.get(this.cacheKey);
    if (cached && cached.length === totalSections) {
      this.sectionPages = [...cached];
      this.isFullyPaginated = true;
      for (let i = 0; i < totalSections; i++) {
        this.measuredSet.add(i);
      }
      return;
    }

    // Initial estimation based on section byte/character size
    this.sectionPages = new Array(totalSections).fill(1);
    const sections = this.book?.sections || [];
    for (let i = 0; i < sections.length; i++) {
      const s = sections[i];
      const sz = typeof s?.size === 'number' && s.size > 0 ? s.size : 2000;
      this.sectionPages[i] = Math.max(1, Math.round(sz / this.bytesPerPage));
    }
  }

  public getTotalBookPages(): number {
    return Math.max(1, this.sectionPages.reduce((acc, p) => acc + p, 0));
  }

  public getIsFullyPaginated(): boolean {
    return this.isFullyPaginated;
  }

  /**
   * Called whenever the live reader relocates or renders a section.
   * This provides ground-truth exact measurements for the currently viewed section.
   */
  public updateLiveSection(sectionIndex: number, _page: number, pages: number) {
    if (this.isFixedLayout) return;
    if (sectionIndex < 0 || sectionIndex >= this.sectionPages.length) return;

    const chapterTotal = this.layout.flow === 'scrolled'
      ? Math.max(1, pages)
      : Math.max(1, pages - 2);

    const section = this.book?.sections?.[sectionIndex];
    const sectionSize = typeof section?.size === 'number' && section.size > 0 ? section.size : 0;

    const prevCount = this.sectionPages[sectionIndex];
    const isNewMeasurement = !this.measuredSet.has(sectionIndex) || prevCount !== chapterTotal;

    if (isNewMeasurement) {
      this.sectionPages[sectionIndex] = chapterTotal;
      this.measuredSet.add(sectionIndex);

      // Calibrate bytes-per-page ratio from all measured sections
      let totalMeasuredSize = 0;
      let totalMeasuredPages = 0;
      for (const idx of this.measuredSet) {
        const sec = this.book?.sections?.[idx];
        const sz = typeof sec?.size === 'number' && sec.size > 0 ? sec.size : 0;
        if (sz > 0 && this.sectionPages[idx] > 0) {
          totalMeasuredSize += sz;
          totalMeasuredPages += this.sectionPages[idx];
        }
      }

      if (totalMeasuredPages > 0 && totalMeasuredSize > 0) {
        this.bytesPerPage = totalMeasuredSize / totalMeasuredPages;
      } else if (sectionSize > 0 && chapterTotal > 0) {
        this.bytesPerPage = sectionSize / chapterTotal;
      }

      // Refine estimates for unmeasured sections
      const sections = this.book?.sections || [];
      for (let i = 0; i < sections.length; i++) {
        if (!this.measuredSet.has(i)) {
          const sz = typeof sections[i]?.size === 'number' && sections[i].size > 0 ? sections[i].size : 2000;
          this.sectionPages[i] = Math.max(1, Math.round(sz / this.bytesPerPage));
        }
      }

      if (this.measuredSet.size === sections.length) {
        this.isFullyPaginated = true;
        memoryPaginationCache.set(this.cacheKey, [...this.sectionPages]);
      }

      this.onUpdateCallback?.(this);
    }
  }

  /**
   * Returns structured page information for current reader position.
   */
  public getPageInfo(
    sectionIndex: number,
    page: number,
    pages: number,
    fraction: number
  ): DevicePageInfo {
    const totalBookPages = this.getTotalBookPages();
    const clampedSectionIndex = Math.max(0, Math.min(sectionIndex, this.sectionPages.length - 1));

    let totalChapterPages = 1;
    let chapterPage = 1;

    if (this.isFixedLayout) {
      totalChapterPages = 1;
      chapterPage = 1;
    } else if (this.layout.flow === 'scrolled') {
      totalChapterPages = Math.max(1, pages);
      chapterPage = Math.max(1, Math.min(page, totalChapterPages));
    } else {
      totalChapterPages = Math.max(1, pages - 2);
      chapterPage = Math.max(1, Math.min(page, totalChapterPages));
    }

    // Calculate global book page
    let pagesBefore = 0;
    for (let i = 0; i < clampedSectionIndex; i++) {
      pagesBefore += this.sectionPages[i] || 1;
    }

    let bookPage: number;
    if (this.isFixedLayout) {
      bookPage = clampedSectionIndex + 1;
    } else {
      bookPage = Math.max(1, Math.min(pagesBefore + chapterPage, totalBookPages));
    }

    const percent = Math.max(0, Math.min(100, Math.round((fraction || 0) * 100)));

    return {
      bookPage,
      totalBookPages,
      chapterPage,
      totalChapterPages,
      percent,
      isEstimated: !this.isFullyPaginated,
      sectionIndex: clampedSectionIndex,
    };
  }

  /**
   * Asynchronously measures all unmeasured sections in background without blocking the UI.
   */
  public async startBackgroundMeasurement(): Promise<void> {
    if (this.isFixedLayout || this.isFullyPaginated) return;

    this.abortController = new AbortController();
    const { signal } = this.abortController;

    const sections = this.book?.sections || [];
    const totalSections = sections.length;
    if (totalSections === 0) return;

    try {
      // Create offscreen measurement container
      this.offscreenIframe = document.createElement('iframe');
      this.offscreenIframe.setAttribute('sandbox', 'allow-same-origin');
      this.offscreenIframe.setAttribute('tabindex', '-1');
      this.offscreenIframe.setAttribute('aria-hidden', 'true');
      this.offscreenIframe.style.cssText = `
        position: fixed !important;
        top: 0 !important;
        left: -10000px !important;
        width: ${Math.max(300, this.layout.width)}px !important;
        height: ${Math.max(300, this.layout.height)}px !important;
        border: 0 !important;
        visibility: hidden !important;
        pointer-events: none !important;
        z-index: -9999 !important;
      `;
      document.body.appendChild(this.offscreenIframe);

      // Prepare iframe document
      const frameDoc = this.offscreenIframe.contentDocument || this.offscreenIframe.contentWindow?.document;
      if (!frameDoc) return;

      const styleEl = frameDoc.createElement('style');
      styleEl.textContent = this.layout.readerCSS;
      frameDoc.head.appendChild(styleEl);

      const maxColumnCount = this.layout.columns === 'auto'
        ? (this.layout.width > 1000 ? 2 : 1)
        : Number(this.layout.columns);
      const gapPx = Math.round(this.layout.width * 0.06);
      const divisor = Math.min(maxColumnCount, Math.ceil(this.layout.width / (this.layout.width / maxColumnCount)));
      const colWidth = (this.layout.width / divisor) - gapPx;

      for (let i = 0; i < totalSections; i++) {
        if (signal.aborted) break;
        if (this.measuredSet.has(i)) continue;

        const section = sections[i];
        if (!section || section.linear === 'no') {
          this.sectionPages[i] = 1;
          this.measuredSet.add(i);
          continue;
        }

        try {
          const doc = await section.createDocument();
          if (signal.aborted) break;
          if (!doc) continue;

          // Mount document body into measurement iframe
          const bodyClone = frameDoc.importNode(doc.body, true);
          frameDoc.body.replaceChildren(bodyClone);

          if (this.layout.flow === 'scrolled') {
            frameDoc.documentElement.style.cssText = `
              box-sizing: border-box !important;
              padding: 0 ${gapPx}px !important;
              margin: 0 !important;
              width: 100% !important;
              height: auto !important;
            `;
            frameDoc.body.style.cssText = `
              margin: auto !important;
              max-width: ${colWidth}px !important;
            `;
            const scrollH = Math.max(frameDoc.documentElement.scrollHeight, frameDoc.body.scrollHeight);
            const pageCount = Math.max(1, Math.ceil(scrollH / this.layout.height));
            this.sectionPages[i] = pageCount;
          } else {
            // Paginated column layout
            frameDoc.documentElement.style.cssText = `
              box-sizing: border-box !important;
              column-width: ${Math.trunc(colWidth)}px !important;
              column-gap: ${gapPx}px !important;
              column-fill: auto !important;
              height: ${this.layout.height}px !important;
              padding: 0 ${gapPx / 2}px !important;
              overflow: hidden !important;
              overflow-wrap: break-word !important;
            `;
            frameDoc.body.style.cssText = `
              margin: 0 !important;
              max-height: none !important;
              max-width: none !important;
            `;

            const range = frameDoc.createRange();
            range.selectNodeContents(frameDoc.body);
            const rect = range.getBoundingClientRect();
            const contentWidth = rect.width;
            const pageCount = Math.max(1, Math.ceil(contentWidth / this.layout.width));
            this.sectionPages[i] = pageCount;
          }

          this.measuredSet.add(i);

          // Update estimate ratio
          const secSize = typeof section?.size === 'number' && section.size > 0 ? section.size : 0;
          if (secSize > 0 && this.sectionPages[i] > 0) {
            this.bytesPerPage = (this.bytesPerPage + (secSize / this.sectionPages[i])) / 2;
          }

          // Refine unmeasured
          for (let j = i + 1; j < totalSections; j++) {
            if (!this.measuredSet.has(j)) {
              const sz = typeof sections[j]?.size === 'number' && sections[j].size > 0 ? sections[j].size : 2000;
              this.sectionPages[j] = Math.max(1, Math.round(sz / this.bytesPerPage));
            }
          }

          this.onUpdateCallback?.(this);
        } catch (err) {
          // If a section fails to createDocument, keep its heuristic estimate
          this.measuredSet.add(i);
        }

        // Yield to browser execution queue so UI stays 60fps
        await new Promise((resolve) => setTimeout(resolve, 15));
      }

      if (!signal.aborted && this.measuredSet.size === totalSections) {
        this.isFullyPaginated = true;
        memoryPaginationCache.set(this.cacheKey, [...this.sectionPages]);
        this.onUpdateCallback?.(this);
      }
    } finally {
      if (this.offscreenIframe && this.offscreenIframe.parentNode) {
        this.offscreenIframe.parentNode.removeChild(this.offscreenIframe);
        this.offscreenIframe = null;
      }
    }
  }

  public destroy() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.offscreenIframe && this.offscreenIframe.parentNode) {
      this.offscreenIframe.parentNode.removeChild(this.offscreenIframe);
      this.offscreenIframe = null;
    }
    this.onUpdateCallback = undefined;
  }
}
