"use strict";

/**
 * Accessible animation controller for expandable Local Tool detail panels.
 *
 * Keeps motion behavior separate from workspace state while respecting users
 * who prefer reduced motion. The controller only owns `details.auto-group`
 * interactions; each feature continues to own its form content.
 */
(function exposeSmoothDetailsController(root) {
  function toggleSmoothDetails(details) {
    const summary = details.querySelector(":scope > summary");
    if (!summary) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const currentTarget = details.dataset.smoothDetailsTarget
      ? details.dataset.smoothDetailsTarget === "open"
      : details.open;
    const opening = !currentTarget;
    details.dataset.smoothDetailsTarget = opening ? "open" : "closed";
    if (reducedMotion || typeof details.animate !== "function") {
      details.open = opening;
      delete details.dataset.smoothDetailsTarget;
      return;
    }

    const currentHeight = details.getBoundingClientRect().height;
    details._smoothDetailsAnimation?.cancel();
    details.style.height = `${currentHeight}px`;
    details.style.overflow = "hidden";
    if (opening) details.open = true;
    const targetHeight = opening ? details.scrollHeight : summary.getBoundingClientRect().height;
    const animation = details.animate(
      { height: [`${currentHeight}px`, `${targetHeight}px`] },
      { duration: opening ? 220 : 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
    );
    details._smoothDetailsAnimation = animation;
    animation.onfinish = () => {
      if (details._smoothDetailsAnimation !== animation) return;
      if (!opening) details.open = false;
      details.style.height = "";
      details.style.overflow = "";
      details._smoothDetailsAnimation = null;
      delete details.dataset.smoothDetailsTarget;
    };
    animation.oncancel = () => {
      if (details._smoothDetailsAnimation === animation) details._smoothDetailsAnimation = null;
    };
  }

  function setupSmoothDetails() {
    document.addEventListener("click", (event) => {
      const summary = event.target.closest("details.auto-group > summary");
      if (!summary) return;
      event.preventDefault();
      toggleSmoothDetails(summary.parentElement);
    });
  }

  root.PassportModuleSmoothDetails = { setupSmoothDetails };
})(globalThis);
