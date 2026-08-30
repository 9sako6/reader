import { useCallback, useLayoutEffect, useRef, type ReactElement, type ReactNode } from "react";
import type { ReaderViewHandlers } from "./types";

export function PageScroller({
  tagName,
  className,
  handlers,
  hidden = false,
  children,
}: {
  tagName: "main" | "div";
  className: string;
  handlers: ReaderViewHandlers;
  hidden?: boolean;
  children: ReactNode;
}): ReactElement {
  const pageScrollHandler = useRef(handlers.pageScroll);
  const pagePositionHandler = useRef(handlers.pagePosition);
  const elementRef = useRef<HTMLElement | null>(null);
  pageScrollHandler.current = handlers.pageScroll;
  pagePositionHandler.current = handlers.pagePosition;
  const ref = useCallback((element: HTMLElement | null) => {
    elementRef.current = element;
  }, []);
  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element || hidden) return;
    pageScrollHandler.current(element);
    return () => pageScrollHandler.current(null);
  }, [hidden]);
  const onScroll = useCallback((event: { currentTarget: EventTarget | null }) => {
    if (event.currentTarget) pagePositionHandler.current(event.currentTarget as HTMLElement);
  }, []);
  const Tag = tagName;
  return (
    <Tag className={className} data-reader-page-scroller="true" ref={ref} onScroll={onScroll} hidden={hidden}>
      {children}
    </Tag>
  );
}
