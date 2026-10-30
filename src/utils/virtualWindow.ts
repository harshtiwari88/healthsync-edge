import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';

export interface VirtualWindowParams {
  totalCount: number;
  scrollTop: number;
  viewportHeight: number;
  itemHeight: number;
  overscan?: number;
}

export interface VirtualWindowSlice {
  startIndex: number;
  endIndex: number;
  topSpacerPx: number;
  bottomSpacerPx: number;
}

/**
 * Pure O(1) virtual viewport slice calculation so rendering 10,000+ historical
 * triage records mounts only ~20 visible rows in the DOM at any instant.
 */
export function computeVirtualWindow({
  totalCount,
  scrollTop,
  viewportHeight,
  itemHeight,
  overscan = 6,
}: VirtualWindowParams): VirtualWindowSlice {
  if (totalCount <= 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      topSpacerPx: 0,
      bottomSpacerPx: 0,
    };
  }

  const safeItemHeight = Math.max(1, itemHeight);
  const safeViewportHeight = Math.max(safeItemHeight, viewportHeight);
  const safeScrollTop = Math.max(0, scrollTop);

  const firstVisible = Math.floor(safeScrollTop / safeItemHeight);
  const visibleCount = Math.ceil(safeViewportHeight / safeItemHeight);

  const startIndex = Math.max(0, firstVisible - overscan);
  const endIndex = Math.min(totalCount, firstVisible + visibleCount + overscan);

  const topSpacerPx = startIndex * safeItemHeight;
  const bottomSpacerPx = Math.max(0, (totalCount - endIndex) * safeItemHeight);

  return {
    startIndex,
    endIndex,
    topSpacerPx,
    bottomSpacerPx,
  };
}

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function useVirtualWindow<
  TContainer extends HTMLElement = HTMLDivElement,
  TSpacer extends HTMLElement = HTMLDivElement,
>(params: {
  count: number;
  itemHeight: number;
  viewportHeight?: number;
  overscan?: number;
  resetKey?: string;
}) {
  const {count, itemHeight, viewportHeight = 560, overscan = 6, resetKey = ''} = params;
  const [scrollTop, setScrollTop] = useState(0);

  const containerRef = useRef<TContainer | null>(null);
  const topSpacerRef = useRef<TSpacer | null>(null);
  const bottomSpacerRef = useRef<TSpacer | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    setScrollTop(0);
    if (containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [resetKey]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null && typeof window !== 'undefined') {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  const handleScroll = useCallback((event: React.UIEvent<TContainer>) => {
    const nextScrollTop = event.currentTarget.scrollTop;
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      setScrollTop(nextScrollTop);
      return;
    }
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      setScrollTop(nextScrollTop);
    });
  }, []);

  const windowSlice = useMemo(
    () =>
      computeVirtualWindow({
        totalCount: count,
        scrollTop,
        viewportHeight,
        itemHeight,
        overscan,
      }),
    [count, scrollTop, viewportHeight, itemHeight, overscan]
  );

  useIsomorphicLayoutEffect(() => {
    if (topSpacerRef.current) {
      topSpacerRef.current.style.height = `${windowSlice.topSpacerPx}px`;
    }
    if (bottomSpacerRef.current) {
      bottomSpacerRef.current.style.height = `${windowSlice.bottomSpacerPx}px`;
    }
  }, [windowSlice.topSpacerPx, windowSlice.bottomSpacerPx]);

  return {
    containerRef,
    topSpacerRef,
    bottomSpacerRef,
    handleScroll,
    startIndex: windowSlice.startIndex,
    endIndex: windowSlice.endIndex,
    topSpacerPx: windowSlice.topSpacerPx,
    bottomSpacerPx: windowSlice.bottomSpacerPx,
  };
}

export function useIsDesktopViewport(minWidthPx = 768): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return true;
    }
    return window.matchMedia(`(min-width: ${minWidthPx}px)`).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia(`(min-width: ${minWidthPx}px)`);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    setIsDesktop(mql.matches);
    mql.addEventListener('change', onChange);
    return () => {
      mql.removeEventListener('change', onChange);
    };
  }, [minWidthPx]);

  return isDesktop;
}
