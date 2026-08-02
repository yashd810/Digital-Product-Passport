import { useEffect, useRef, useState } from "react";

/**
 * Keeps an overlay mounted just long enough for its closing CSS transition to
 * finish. It also respects the user's reduced-motion preference.
 */
export function useMotionPresence(isOpen, exitDuration = 180) {
  const [isPresent, setIsPresent] = useState(isOpen);
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (isOpen) {
      setIsPresent(true);
      return undefined;
    }

    if (!isPresent) return undefined;

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    timeoutRef.current = window.setTimeout(() => {
      setIsPresent(false);
      timeoutRef.current = null;
    }, reducedMotion ? 0 : exitDuration);

    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [exitDuration, isOpen, isPresent]);

  return isPresent;
}
