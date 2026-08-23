import { useCallback, useLayoutEffect, useRef, type CSSProperties, type ReactElement, type ReactNode } from "react";
import type { ReaderViewHandlers } from "./types";

export function ReaderTextScroller({
  tagName,
  className,
  style,
  handlers,
  children,
}: {
  tagName: "main" | "div";
  className: string;
  style: CSSProperties;
  handlers: ReaderViewHandlers;
  children: ReactNode;
}): ReactElement {
  const textScrollHandler = useRef(handlers.textScroll);
  const textPositionHandler = useRef(handlers.textPosition);
  const elementRef = useRef<HTMLElement | null>(null);
  textScrollHandler.current = handlers.textScroll;
  textPositionHandler.current = handlers.textPosition;
  const ref = useCallback((element: HTMLElement | null) => {
    elementRef.current = element;
  }, []);
  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    textScrollHandler.current(element);
    return () => textScrollHandler.current(null);
  }, []);
  const onScroll = useCallback((event: { currentTarget: EventTarget | null }) => {
    if (event.currentTarget) textPositionHandler.current(event.currentTarget as HTMLElement);
  }, []);
  const Tag = tagName;
  return (
    <Tag className={className} data-reader-text-scroller="true" ref={ref} onScroll={onScroll} style={style}>
      {children}
    </Tag>
  );
}
