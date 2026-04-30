# Accessibility And Portability

Last updated: 2026-04-30

## What is implemented in code

The frontend now explicitly supports several baseline accessibility and portability requirements:

- keyboard-operable accordions and section toggles in the passport form and consumer viewer
- dialog semantics for the main dashboard modals used in passport editing flows
- screen-reader labels for close buttons and hidden dialog descriptions where needed
- `aria-expanded` and `aria-controls` wiring for collapsible viewer and preview sections
- `aria-live` / status roles for save, loading, and update feedback
- semantic table captions for admin governance tables
- a global skip link to `#app-main-content`
- a dedicated trusted-entry panel with labeled report action and live feedback states
- frontend automated accessibility tests with Vitest, Testing Library, and axe
- CI contrast checks for the main viewer and trusted-entry color pairs
- no dependency on vendor-specific desktop or mobile apps for core verification and data-entry flows

## Low-bandwidth and portability position

The app remains browser-based and standards-facing operations are available over plain HTTPS and JSON:

- DPP payloads can be read through API endpoints
- CSV and JSON imports do not depend on proprietary office integrations
- signed verification material is exposed through HTTP endpoints
- document links can be opened directly without a vendor-specific viewer

Inline PDF preview is progressive enhancement. Users can still open the original document directly if preview loading is undesirable on constrained networks.

## What still requires manual validation

Repo inspection and build verification do not prove full WCAG conformance by themselves. The following still need manual and/or assistive-technology testing in a browser:

- screen-reader announcement quality across complete workflows
- visible focus order through every dashboard table, modal, and bulk-action flow
- color-contrast review of all themes and company branding variants
- zoom/reflow behavior at 200% and 400%
- keyboard trap and escape-key behavior for every modal in the app
- real low-bandwidth performance measurement on slow connections

## Recommended validation checklist

For release readiness, run:

1. Keyboard-only walkthrough of login, dashboard, passport create/edit, viewer, and admin type-builder flows.
2. Screen-reader checks with VoiceOver, NVDA, or JAWS on the same flows.
3. Automated browser audits with Lighthouse and axe on the main public and authenticated pages.
4. Contrast checks for default themes plus at least one branded company theme.
5. Network throttling checks for public viewer, JSON export, and PDF preview/open flows.

## CI coverage now in place

The frontend CI job now runs:

1. `npm test`
2. `npm run test:contrast`
3. `npm run build`
