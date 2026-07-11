import React, { useEffect, useMemo, useRef, useState } from "react";

function AdminSelectMenu({
  id,
  value,
  options,
  onChange,
  disabled = false,
  placeholder = "Select",
  triggerLabel,
  className = "",
  triggerClassName = "",
  menuClassName = "",
  optionClassName = "",
  title,
  ariaLabel,
}) {
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);

  const selectedOption = useMemo(
    () => options.find((option) => option.value === value),
    [options, value]
  );

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`admin-select ${className}`.trim()}>
      <button
        id={id}
        type="button"
        className={`admin-select-trigger ${open ? "open" : ""} ${triggerClassName}`.trim()}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
      >
        <span className="admin-select-trigger-label">
          {triggerLabel || selectedOption?.label || placeholder}
        </span>
        <span className="admin-select-trigger-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className={`admin-select-menu ${menuClassName}`.trim()} role="listbox" aria-labelledby={id}>
          {options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                className={`admin-select-option ${selected ? "selected" : ""} ${optionClassName}`.trim()}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span className="admin-select-option-label">{option.label}</span>
                {selected && <span className="admin-select-option-check" aria-hidden="true">✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default AdminSelectMenu;
