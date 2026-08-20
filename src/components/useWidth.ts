import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Measures a block element so SVGs can be drawn at exact pixel size.
 *
 * Deliberately a callback ref rather than an effect: these components render
 * a zero-width placeholder on the first pass and swap in a different root
 * once the width is known. An observer bound in an effect would stay attached
 * to the discarded placeholder and never fire again, freezing the drawing at
 * its first measured width.
 */
export function useWidth<T extends HTMLElement>() {
  const [w, setW] = useState(0);
  const nodeRef = useRef<T | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);

  // Floored: contentRect reports fractional widths, and drawing an SVG 0.2px
  // wider than its container is enough to give the page a horizontal scrollbar.
  const measure = useCallback((node: T | null) => {
    if (!node) return;
    setW(Math.floor(node.getBoundingClientRect().width));
  }, []);

  const ref = useCallback(
    (node: T | null) => {
      roRef.current?.disconnect();
      roRef.current = null;
      nodeRef.current = node;
      if (!node) return;

      if (typeof ResizeObserver !== "undefined") {
        const ro = new ResizeObserver(([entry]) =>
          setW(Math.floor(entry.contentRect.width)),
        );
        ro.observe(node);
        roRef.current = ro;
      }
      measure(node);
    },
    [measure],
  );

  // Fallback for the case where ResizeObserver never fires — an embedded or
  // headless viewport, or an old engine. Without it a chart measured at the
  // wrong moment stays that size for the life of the page, which is a silent
  // and very confusing failure.
  useEffect(() => {
    const onResize = () => measure(nodeRef.current);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measure]);

  return [ref, w] as const;
}
