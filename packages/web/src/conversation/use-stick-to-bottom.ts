import { useCallback, useEffect, useRef, useState } from "react";

const STICK_THRESHOLD_PX = 48;

function distanceFromBottom(element: HTMLElement): number {
  return element.scrollHeight - element.scrollTop - element.clientHeight;
}

/**
 * Keeps a scroll container pinned to its newest content, until the user scrolls up.
 * Scrolling back near the bottom (or `scrollToBottom`) pins it again.
 */
export function useStickToBottom() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const lastScrollTop = useRef(0);
  const [atBottom, setAtBottom] = useState(true);

  const scrollToBottom = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    pinned.current = true;
    setAtBottom(true);
    element.scrollTop = element.scrollHeight;
    lastScrollTop.current = element.scrollTop;
  }, []);

  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const scrolledUp = element.scrollTop < lastScrollTop.current;
    lastScrollTop.current = element.scrollTop;
    const nearBottom = distanceFromBottom(element) <= STICK_THRESHOLD_PX;
    if (nearBottom) pinned.current = true;
    else if (scrolledUp) pinned.current = false;
    setAtBottom(pinned.current);
  }, []);

  useEffect(() => {
    const content = contentRef.current;
    const scroller = scrollRef.current;
    if (!content || !scroller) return;
    const follow = () => {
      if (!pinned.current) return;
      scroller.scrollTop = scroller.scrollHeight;
      lastScrollTop.current = scroller.scrollTop;
    };
    follow();
    const observer = new ResizeObserver(follow);
    observer.observe(content);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  return { scrollRef, contentRef, atBottom, onScroll, scrollToBottom };
}
