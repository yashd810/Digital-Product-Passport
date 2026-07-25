import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

function textFromNode(node) {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textFromNode).join("");
  if (React.isValidElement(node)) return textFromNode(node.props.children);
  return "";
}

function normalizeOption(option, index) {
  const value = String(option?.value ?? "");
  return {
    key: option?.key ?? `${value}-${index}`,
    value,
    label: String(option?.label ?? value),
    disabled: option?.disabled === true,
  };
}

export function getAppSelectOptions(children) {
  const options = [];

  const visit = (nodes) => {
    React.Children.forEach(nodes, (child) => {
      if (!React.isValidElement(child)) return;

      if (child.type === React.Fragment || child.type === "optgroup") {
        visit(child.props.children);
        return;
      }

      if (child.type !== "option") return;

      const value = String(child.props.value ?? "");
      options.push({
        key: child.key ?? `${value}-${options.length}`,
        value,
        label: String(child.props.label ?? textFromNode(child.props.children)),
        disabled: child.props.disabled === true,
      });
    });
  };

  visit(children);
  return options;
}

export function getNextEnabledOptionIndex(options, startIndex, direction) {
  if (!options.length) return -1;

  for (let offset = 1; offset <= options.length; offset += 1) {
    const index = (startIndex + (direction * offset) + options.length) % options.length;
    if (!options[index]?.disabled) return index;
  }

  return -1;
}

function getFirstEnabledOptionIndex(options) {
  return options.findIndex((option) => !option.disabled);
}

function getLastEnabledOptionIndex(options) {
  for (let index = options.length - 1; index >= 0; index -= 1) {
    if (!options[index]?.disabled) return index;
  }
  return -1;
}

function getSelectedOptionIndex(options, value) {
  return options.findIndex((option) => option.value === String(value ?? ""));
}

function buildMenuPosition(trigger, optionCount) {
  const rect = trigger.getBoundingClientRect();
  const margin = 12;
  const gap = 7;
  const minWidth = 190;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(
    Math.max(rect.width, minWidth),
    Math.max(minWidth, viewportWidth - (margin * 2)),
  );
  const estimatedHeight = Math.min(360, Math.max(88, (optionCount * 42) + 16));
  const availableBelow = viewportHeight - rect.bottom - gap - margin;
  const availableAbove = rect.top - gap - margin;
  const openUpward = availableBelow < Math.min(estimatedHeight, 180) && availableAbove > availableBelow;
  const maxHeight = Math.max(
    96,
    Math.min(360, openUpward ? availableAbove : availableBelow),
  );
  const left = Math.min(
    Math.max(margin, rect.left),
    Math.max(margin, viewportWidth - width - margin),
  );
  const top = openUpward
    ? Math.max(margin, rect.top - gap - Math.min(estimatedHeight, maxHeight))
    : rect.bottom + gap;

  return {
    left,
    top,
    width,
    maxHeight,
    placement: openUpward ? "top" : "bottom",
  };
}

function buildProxyOptions(options) {
  return options.map((option) => (
    <option key={option.key} value={option.value} disabled={option.disabled}>
      {option.label}
    </option>
  ));
}

/**
 * App-owned single-select control.
 *
 * The transparent native proxy keeps existing form/event contracts intact;
 * the button and portalled listbox are the only visible controls. This avoids
 * platform-owned option popups while retaining the application's native-select
 * callbacks (`event.target.value`) without per-page adapter code.
 */
function AppSelect({
  id,
  name,
  form,
  value,
  defaultValue,
  onChange,
  onBlur,
  onFocus,
  onInvalid,
  onValueChange,
  disabled = false,
  required = false,
  className = "",
  style,
  title,
  children,
  options: explicitOptions,
  placeholder = "Select an option",
  triggerLabel,
  menuClassName = "",
  optionClassName = "",
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  autoFocus,
}) {
  const generatedId = useId();
  const triggerId = id || `app-select-${generatedId}`;
  const listboxId = `${triggerId}-listbox`;
  const nativeRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const typeaheadRef = useRef({ text: "", time: 0 });
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuPosition, setMenuPosition] = useState(null);
  const [uncontrolledValue, setUncontrolledValue] = useState(
    String(defaultValue ?? ""),
  );
  const isControlled = value !== undefined;
  const selectedValue = String(isControlled ? (value ?? "") : uncontrolledValue);
  const optionRecords = useMemo(
    () => (explicitOptions
      ? explicitOptions.map(normalizeOption)
      : getAppSelectOptions(children)),
    [children, explicitOptions],
  );
  const proxyChildren = explicitOptions ? buildProxyOptions(optionRecords) : children;
  const selectedIndex = getSelectedOptionIndex(optionRecords, selectedValue);
  const selectedOption = optionRecords[selectedIndex];
  const visibleLabel = triggerLabel || selectedOption?.label || placeholder;
  const activeOptionId = activeIndex >= 0
    ? `${listboxId}-option-${activeIndex}`
    : undefined;

  const updateMenuPosition = useCallback(() => {
    if (!triggerRef.current || typeof window === "undefined") return;
    setMenuPosition(buildMenuPosition(triggerRef.current, optionRecords.length));
  }, [optionRecords.length]);

  const closeMenu = useCallback(() => {
    setOpen(false);
  }, []);

  const openMenu = useCallback((preferredIndex) => {
    if (disabled) return;
    const fallbackIndex = selectedIndex >= 0 && !optionRecords[selectedIndex]?.disabled
      ? selectedIndex
      : getFirstEnabledOptionIndex(optionRecords);
    setMounted(true);
    setOpen(true);
    setActiveIndex(preferredIndex ?? fallbackIndex);
  }, [disabled, optionRecords, selectedIndex]);

  const emitNativeValue = useCallback((nextValue) => {
    const normalizedValue = String(nextValue ?? "");
    if (!isControlled) setUncontrolledValue(normalizedValue);
    setInvalid(false);

    const proxy = nativeRef.current;
    if (!proxy) {
      onValueChange?.(normalizedValue);
      onChange?.({
        target: { value: normalizedValue, name },
        currentTarget: { value: normalizedValue, name },
        type: "change",
      });
      return;
    }

    const setter = typeof HTMLSelectElement === "undefined"
      ? null
      : Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    if (setter) setter.call(proxy, normalizedValue);
    else proxy.value = normalizedValue;
    proxy.dispatchEvent(new Event("change", { bubbles: true }));
    onValueChange?.(normalizedValue);
  }, [isControlled, name, onChange, onValueChange]);

  const selectActiveOption = useCallback(() => {
    const option = optionRecords[activeIndex];
    if (!option || option.disabled) return;
    emitNativeValue(option.value);
    closeMenu();
    triggerRef.current?.focus({ preventScroll: true });
  }, [activeIndex, closeMenu, emitNativeValue, optionRecords]);

  const moveActiveOption = useCallback((direction, steps = 1) => {
    if (!optionRecords.length) return;
    const firstEnabled = getFirstEnabledOptionIndex(optionRecords);
    if (firstEnabled < 0) return;
    let nextIndex = activeIndex >= 0 ? activeIndex : firstEnabled;
    for (let step = 0; step < steps; step += 1) {
      nextIndex = getNextEnabledOptionIndex(optionRecords, nextIndex, direction);
      if (nextIndex < 0) return;
    }
    setActiveIndex(nextIndex);
  }, [activeIndex, optionRecords]);

  const handleTriggerKeyDown = (event) => {
    if (disabled) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) openMenu();
      else moveActiveOption(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) openMenu(getLastEnabledOptionIndex(optionRecords));
      else moveActiveOption(-1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      openMenu(getFirstEnabledOptionIndex(optionRecords));
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      openMenu(getLastEnabledOptionIndex(optionRecords));
      return;
    }
    if (event.key === "PageDown") {
      event.preventDefault();
      if (!open) openMenu();
      else moveActiveOption(1, 5);
      return;
    }
    if (event.key === "PageUp") {
      event.preventDefault();
      if (!open) openMenu();
      else moveActiveOption(-1, 5);
      return;
    }
    if (event.key === "Escape") {
      if (open) event.preventDefault();
      closeMenu();
      return;
    }
    if (event.key === "Tab") {
      closeMenu();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) openMenu();
      else selectActiveOption();
      return;
    }
    if (event.key.length !== 1 || event.altKey || event.ctrlKey || event.metaKey) return;

    const now = Date.now();
    const previous = typeaheadRef.current;
    const text = now - previous.time > 650
      ? event.key.toLocaleLowerCase()
      : `${previous.text}${event.key.toLocaleLowerCase()}`;
    typeaheadRef.current = { text, time: now };
    const matchingIndex = optionRecords.findIndex((option) => (
      !option.disabled && option.label.toLocaleLowerCase().startsWith(text)
    ));
    if (matchingIndex >= 0) {
      event.preventDefault();
      openMenu(matchingIndex);
    }
  };

  const handleProxyChange = (event) => {
    if (!isControlled) setUncontrolledValue(String(event.target.value ?? ""));
    onChange?.(event);
  };

  const handleInvalid = (event) => {
    event.preventDefault();
    setInvalid(true);
    triggerRef.current?.focus({ preventScroll: true });
    onInvalid?.(event);
  };

  useEffect(() => {
    if (open) {
      updateMenuPosition();
      return undefined;
    }
    const timeout = window.setTimeout(() => setMounted(false), 150);
    return () => window.clearTimeout(timeout);
  }, [open, updateMenuPosition]);

  useEffect(() => {
    if (!open || typeof document === "undefined") return undefined;

    const handlePointerDown = (event) => {
      const target = event.target;
      if (
        !triggerRef.current?.contains(target)
        && !menuRef.current?.contains(target)
      ) {
        closeMenu();
      }
    };
    const handleViewportChange = () => updateMenuPosition();

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [closeMenu, open, updateMenuPosition]);

  const menu = mounted ? (
    <div
      ref={menuRef}
      id={listboxId}
      role="listbox"
      aria-labelledby={triggerId}
      aria-hidden={!open}
      data-state={open ? "open" : "closed"}
      data-placement={menuPosition?.placement || "bottom"}
      className={`app-select__menu ${menuClassName}`.trim()}
      style={{
        left: menuPosition?.left ?? 0,
        top: menuPosition?.top ?? 0,
        width: menuPosition?.width ?? "auto",
        maxHeight: menuPosition?.maxHeight ?? 360,
        visibility: menuPosition ? "visible" : "hidden",
        pointerEvents: open ? "auto" : "none",
      }}
    >
      {optionRecords.length ? optionRecords.map((option, index) => (
        <div
          key={option.key}
          id={`${listboxId}-option-${index}`}
          role="option"
          aria-selected={option.value === selectedValue}
          aria-disabled={option.disabled || undefined}
          data-active={index === activeIndex || undefined}
          data-selected={option.value === selectedValue || undefined}
          data-disabled={option.disabled || undefined}
          className={`app-select__option ${optionClassName}`.trim()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (option.disabled) return;
            setActiveIndex(index);
            emitNativeValue(option.value);
            closeMenu();
            triggerRef.current?.focus({ preventScroll: true });
          }}
        >
          <span className="app-select__option-label">{option.label}</span>
          {option.value === selectedValue && <span className="app-select__option-check" aria-hidden="true">✓</span>}
        </div>
      )) : (
        <div className="app-select__empty" role="status">No options available</div>
      )}
    </div>
  ) : null;

  return (
    <>
      <select
        ref={nativeRef}
        className="app-select__native"
        name={name}
        form={form}
        value={isControlled ? selectedValue : undefined}
        defaultValue={isControlled ? undefined : String(defaultValue ?? "")}
        onChange={handleProxyChange}
        onInvalid={handleInvalid}
        disabled={disabled}
        required={required}
        tabIndex={-1}
        aria-hidden="true"
      >
        {proxyChildren}
      </select>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className={`app-select__trigger ${className}${open ? " is-open" : ""}${invalid ? " is-invalid" : ""}`.trim()}
        style={style}
        title={title}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open ? activeOptionId : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid ?? (invalid || undefined)}
        aria-required={required || undefined}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        <span className="app-select__value">{visibleLabel}</span>
        <svg className="app-select__chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {invalid && (
        <span className="app-select__validation-message" role="alert">
          Please choose an option.
        </span>
      )}
      {menu && typeof document !== "undefined" ? createPortal(menu, document.body) : menu}
    </>
  );
}

export default AppSelect;
