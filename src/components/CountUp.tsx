import { useEffect, useRef, useState } from "react";

type Props = {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  /** Force a leading + on positive values. */
  signed?: boolean;
};

/**
 * Counts a figure up when it scrolls into view. Metrics should look
 * computed, not typed in.
 */
export function CountUp({
  value,
  decimals = 2,
  prefix = "",
  suffix = "",
  duration = 900,
  signed = false,
}: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(value);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setShown(value);
      return;
    }

    const run = () => {
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min((now - t0) / duration, 1);
        // Ease out — fast settle, no bounce.
        setShown(value * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    // Re-run whenever the value itself changes after the first reveal.
    if (started.current) {
      run();
      return;
    }

    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        started.current = true;
        run();
        io.disconnect();
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [value, duration]);

  const sign = signed && value > 0 ? "+" : "";

  return (
    <span ref={ref} className="mono">
      {sign}
      {prefix}
      {shown.toFixed(decimals)}
      {suffix}
    </span>
  );
}
