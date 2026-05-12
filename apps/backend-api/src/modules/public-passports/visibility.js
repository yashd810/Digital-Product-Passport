"use strict";

function isPublicVersionVisible(status, explicitVisibility, fallbackIsPublicHistoryStatus) {
  if (explicitVisibility !== null && explicitVisibility !== undefined) {
    return !!explicitVisibility;
  }
  return typeof fallbackIsPublicHistoryStatus === "function"
    ? fallbackIsPublicHistoryStatus(status)
    : status === "released" || status === "obsolete";
}

module.exports = {
  isPublicVersionVisible,
};
