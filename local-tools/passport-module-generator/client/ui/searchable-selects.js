"use strict";

/**
 * Accessible searchable-select enhancement for the Generator workspace.
 *
 * Native single-select controls remain the source of truth. This browser-only
 * adapter adds a searchable popover, mirrors value/disabled state, and cleans
 * up detached controls while keeping the workspace controller domain-focused.
 */
(function attachSearchableSelects(globalScope) {
  const select = (selector, root = document) => root.querySelector(selector);
  const selectAll = (selector, root = document) => [...root.querySelectorAll(selector)];
  let sequence = 0;
  let openInstance = null;
  let observer = null;
  let refreshQueued = false;
  let positionQueued = false;
  let initialized = false;

  function controlLabel(nativeSelect) {
    const explicitLabel = nativeSelect.getAttribute("aria-label");
    if (explicitLabel) return explicitLabel;
    const label = nativeSelect.closest("label");
    if (!label) return nativeSelect.name || nativeSelect.id || "dropdown";
    const text = [...label.childNodes]
      .filter((node) => node !== nativeSelect && !node.matches?.("[data-searchable-select]"))
      .map((node) => node.textContent || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    return text || nativeSelect.name || nativeSelect.id || "dropdown";
  }

  function selectedText(nativeSelect) {
    return nativeSelect.selectedOptions?.[0]?.textContent?.trim()
      || nativeSelect.options?.[nativeSelect.selectedIndex]?.textContent?.trim()
      || "Select an option";
  }

  function positionMenu(instance) {
    if (!instance || instance.menu.hidden || !instance.wrapper.isConnected) return;
    const rect = instance.trigger.getBoundingClientRect();
    const viewportPadding = 12;
    const menuWidth = Math.min(
      Math.max(rect.width, 280),
      window.innerWidth - (viewportPadding * 2)
    );
    const below = window.innerHeight - rect.bottom - viewportPadding;
    const above = rect.top - viewportPadding;
    const openAbove = below < 260 && above > below;
    const availableHeight = Math.max(180, Math.min(420, openAbove ? above - 8 : below - 8));
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      window.innerWidth - menuWidth - viewportPadding
    );

    instance.menu.style.width = `${menuWidth}px`;
    instance.menu.style.left = `${left}px`;
    instance.menu.style.maxHeight = `${availableHeight}px`;
    if (openAbove) {
      instance.menu.style.top = "auto";
      instance.menu.style.bottom = `${window.innerHeight - rect.top + 6}px`;
    } else {
      instance.menu.style.top = `${rect.bottom + 6}px`;
      instance.menu.style.bottom = "auto";
    }
  }

  function close(instance = openInstance, { restoreFocus = false } = {}) {
    if (!instance) return;
    instance.menu.classList.remove("searchable-select-menu-open");
    instance.menu.setAttribute("aria-hidden", "true");
    instance.wrapper.classList.remove("searchable-select-open");
    instance.trigger.setAttribute("aria-expanded", "false");
    instance.search.value = "";
    if (instance.closeTimer) window.clearTimeout(instance.closeTimer);
    const finishClosing = () => {
      instance.closeTimer = null;
      if (!instance.menu.classList.contains("searchable-select-menu-open")) {
        instance.menu.hidden = true;
      }
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      finishClosing();
    } else {
      instance.closeTimer = window.setTimeout(finishClosing, 170);
    }
    if (openInstance === instance) openInstance = null;
    if (restoreFocus && instance.wrapper.isConnected) instance.trigger.focus();
  }

  function renderOptions(instance) {
    if (!instance) return;
    const { select: nativeSelect, optionsHost, search } = instance;
    const query = search.value.trim().toLowerCase();
    optionsHost.innerHTML = "";
    let visibleCount = 0;

    [...nativeSelect.options].forEach((option) => {
      if (option.hidden) return;
      const groupLabel = option.parentElement?.tagName === "OPTGROUP"
        ? option.parentElement.label
        : "";
      const optionText = option.textContent?.trim() || option.value || "Blank option";
      const searchableText = `${groupLabel} ${optionText} ${option.value}`.toLowerCase();
      if (query && !searchableText.includes(query)) return;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "searchable-select-option";
      button.dataset.value = option.value;
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", option.selected ? "true" : "false");
      button.disabled = option.disabled;
      if (option.selected) button.classList.add("selected");
      if (!option.value) button.classList.add("placeholder-option");

      const label = document.createElement("span");
      label.className = "searchable-select-option-label";
      label.textContent = groupLabel ? `${groupLabel} · ${optionText}` : optionText;
      const check = document.createElement("span");
      check.className = "searchable-select-option-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = option.selected ? "✓" : "";
      button.append(label, check);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (option.disabled) return;
        nativeSelect.value = option.value;
        nativeSelect.dispatchEvent(new Event("input", { bubbles: true }));
        nativeSelect.dispatchEvent(new Event("change", { bubbles: true }));
        sync(nativeSelect);
        close(instance, { restoreFocus: true });
      });
      optionsHost.appendChild(button);
      visibleCount += 1;
    });

    instance.empty.hidden = visibleCount > 0;
  }

  function sync(nativeSelect) {
    const instance = nativeSelect?._searchableSelect;
    if (!instance) return;
    const selected = selectedText(nativeSelect);
    if (instance.value.textContent !== selected) instance.value.textContent = selected;
    instance.trigger.setAttribute("aria-label", `${instance.controlLabel}: ${selected}`);
    instance.value.classList.toggle("placeholder", nativeSelect.selectedIndex < 0 || !nativeSelect.value);
    instance.trigger.classList.toggle("disabled", nativeSelect.disabled);
    instance.trigger.setAttribute("aria-disabled", nativeSelect.disabled ? "true" : "false");
    instance.trigger.setAttribute("aria-required", nativeSelect.required ? "true" : "false");
    instance.trigger.tabIndex = nativeSelect.disabled ? -1 : 0;
    instance.trigger.title = nativeSelect.title || "";
    if (openInstance === instance) {
      renderOptions(instance);
      positionMenu(instance);
    }
  }

  function open(instance) {
    if (!instance || instance.select.disabled) return;
    if (openInstance && openInstance !== instance) close(openInstance);
    openInstance = instance;
    sync(instance.select);
    if (instance.closeTimer) {
      window.clearTimeout(instance.closeTimer);
      instance.closeTimer = null;
    }
    instance.menu.hidden = false;
    instance.menu.setAttribute("aria-hidden", "false");
    instance.wrapper.classList.add("searchable-select-open");
    instance.trigger.setAttribute("aria-expanded", "true");
    renderOptions(instance);
    positionMenu(instance);
    window.requestAnimationFrame(() => {
      instance.menu.classList.add("searchable-select-menu-open");
      positionMenu(instance);
      instance.search.focus();
    });
  }

  function enhance(nativeSelect) {
    if (!(nativeSelect instanceof HTMLSelectElement) || nativeSelect.multiple) return;
    if (nativeSelect._searchableSelect) {
      sync(nativeSelect);
      return;
    }

    sequence += 1;
    const label = controlLabel(nativeSelect);
    const wrapper = document.createElement("span");
    wrapper.className = "searchable-select";
    wrapper.dataset.searchableSelect = "true";
    const trigger = document.createElement("span");
    trigger.className = "searchable-select-trigger";
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-autocomplete", "list");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", label);
    const value = document.createElement("span");
    value.className = "searchable-select-value";
    const chevron = document.createElement("span");
    chevron.className = "searchable-select-chevron";
    chevron.setAttribute("aria-hidden", "true");
    trigger.append(value, chevron);

    const menu = document.createElement("div");
    menu.className = "searchable-select-menu";
    menu.dataset.searchableSelectMenu = "true";
    menu.hidden = true;
    menu.setAttribute("aria-hidden", "true");
    const searchWrap = document.createElement("div");
    searchWrap.className = "searchable-select-search-wrap";
    const search = document.createElement("input");
    search.type = "search";
    search.className = "searchable-select-search";
    search.placeholder = "Search options…";
    search.setAttribute("aria-label", `Search ${label} options`);
    search.autocomplete = "off";
    const optionsHost = document.createElement("div");
    optionsHost.className = "searchable-select-options";
    optionsHost.id = `searchable-select-options-${sequence}`;
    optionsHost.setAttribute("role", "listbox");
    optionsHost.setAttribute("aria-label", `${label} options`);
    const empty = document.createElement("p");
    empty.className = "searchable-select-empty";
    empty.textContent = "No matching options";
    empty.hidden = true;
    searchWrap.appendChild(search);
    menu.append(searchWrap, optionsHost, empty);
    trigger.setAttribute("aria-controls", optionsHost.id);
    search.setAttribute("aria-controls", optionsHost.id);

    nativeSelect.parentNode.insertBefore(wrapper, nativeSelect);
    wrapper.append(nativeSelect, trigger);
    document.body.appendChild(menu);
    nativeSelect.classList.add("searchable-select-native");
    nativeSelect.tabIndex = -1;
    nativeSelect.setAttribute("aria-hidden", "true");

    const instance = {
      select: nativeSelect,
      controlLabel: label,
      wrapper,
      trigger,
      value,
      menu,
      search,
      optionsHost,
      empty,
    };
    nativeSelect._searchableSelect = instance;
    menu._searchableSelect = instance;

    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (openInstance === instance) close(instance);
      else open(instance);
    });
    trigger.addEventListener("keydown", (event) => {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        open(instance);
      } else if (event.key === "Escape") {
        close(instance);
      }
    });
    search.addEventListener("input", () => renderOptions(instance));
    search.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(instance, { restoreFocus: true });
        return;
      }
      if (event.key === "ArrowDown") {
        const firstOption = select(".searchable-select-option:not(:disabled)", optionsHost);
        if (firstOption) {
          event.preventDefault();
          firstOption.focus();
        }
      }
    });
    nativeSelect.addEventListener("input", () => sync(nativeSelect));
    nativeSelect.addEventListener("change", () => sync(nativeSelect));
    nativeSelect.addEventListener("focus", () => trigger.focus());
    nativeSelect.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      open(instance);
    });
    sync(nativeSelect);
  }

  function refresh(root = document) {
    const selects = [
      ...(root instanceof HTMLSelectElement ? [root] : []),
      ...selectAll("select", root),
    ];
    selects.forEach(enhance);
    selects.forEach(sync);
    selectAll("[data-searchable-select-menu]").forEach((menu) => {
      const instance = menu._searchableSelect;
      if (instance && !instance.wrapper.isConnected) close(instance);
      if (instance && !instance.wrapper.isConnected) menu.remove();
    });
  }

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    window.requestAnimationFrame(() => {
      refreshQueued = false;
      refresh();
    });
  }

  function queuePosition() {
    if (positionQueued) return;
    positionQueued = true;
    window.requestAnimationFrame(() => {
      positionQueued = false;
      positionMenu(openInstance);
    });
  }

  function setupSearchableSelects() {
    refresh();
    if (initialized) return;
    initialized = true;
    observer = new MutationObserver((records) => {
      const needsRefresh = records.some((record) => {
        if (record.type === "attributes") {
          return record.target.matches?.("select, option, optgroup");
        }
        if (record.target.matches?.("select, optgroup")) return true;
        return [...record.addedNodes, ...record.removedNodes].some((node) =>
          node instanceof Element
          && (node.matches("select") || Boolean(node.querySelector("select")))
        );
      });
      if (needsRefresh) queueRefresh();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled", "required", "selected", "title", "label"],
    });
    document.addEventListener("click", (event) => {
      if (
        openInstance
        && !openInstance.wrapper.contains(event.target)
        && !openInstance.menu.contains(event.target)
      ) {
        close(openInstance);
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && openInstance) {
        close(openInstance, { restoreFocus: true });
      }
    });
    window.addEventListener("resize", queuePosition);
    document.addEventListener("scroll", queuePosition, true);
  }

  globalScope.PassportModuleSearchableSelects = {
    setupSearchableSelects,
    refreshSearchableSelects: refresh,
    queueSearchableSelectRefresh: queueRefresh,
  };
})(globalThis);
