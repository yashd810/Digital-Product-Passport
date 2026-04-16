import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function CompletenessBar({ pct }) {
  if (pct === null) return <span className="completeness-empty">—</span>;
  const tone = pct >= 80 ? "high" : pct >= 50 ? "medium" : "low";
  return (
    <div className="completeness-bar">
      <div className="completeness-track">
        <div className={`completeness-fill completeness-fill-${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`completeness-pill completeness-pill-${tone}`}>{pct}%</span>
    </div>
  );
}

export function KebabMenu({ anchorRect, onClose, children }) {
  const ref = useRef(null);
  const [resolvedPos, setResolvedPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const handler = (e) => {
      if (e.target.closest(".kebab-menu-btn")) return;
      if (e.target.closest("tr.passport-row-clickable")) return;
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    if (!ref.current || !anchorRect) return;

    const margin = 12;
    const menuRect = ref.current.getBoundingClientRect();
    let nextTop = anchorRect.bottom + 4;
    let nextLeft = anchorRect.right - menuRect.width;

    nextLeft = Math.min(nextLeft, window.innerWidth - menuRect.width - margin);
    nextLeft = Math.max(nextLeft, margin);

    if (nextTop + menuRect.height > window.innerHeight - margin) {
      nextTop = Math.max(margin, anchorRect.top - menuRect.height - 4);
    }

    setResolvedPos((currentPos) => (
      nextTop !== currentPos.top || nextLeft !== currentPos.left
        ? { top: nextTop, left: nextLeft }
        : currentPos
    ));
  }, [anchorRect, children]);

  return createPortal(
    <div ref={ref} className="kebab-dropdown-menu" style={{ top: resolvedPos.top, left: resolvedPos.left }}>
      {children}
    </div>,
    document.body
  );
}
