# Frontend Documentation Index

This index provides quick navigation and comprehensive reference for frontend development documentation, including accessibility standards, migration plans, and development guidelines.

---

## Table of Contents

1. [Quick Navigation](#quick-navigation)
2. [Frontend Documentation Overview](#frontend-documentation-overview)
3. [Document Descriptions](#document-descriptions)
4. [Getting Started](#getting-started)
5. [Development Patterns](#development-patterns)
6. [Accessibility Standards](#accessibility-standards)
7. [Frontend Statistics](#frontend-statistics)
8. [Related Documentation](#related-documentation)

---

## Quick Navigation

| Topic | File | Focus | Status |
|-------|------|-------|--------|
| [Accessibility](#accessibility-and-portability) | accessibility-and-portability.md | WCAG compliance and a11y implementation | Current |
| [Vue Migration](#vue-migration-plan) | vue-migration-plan.md | React to Vue migration strategy | Planning |

---

## Frontend Documentation Overview

### Accessibility And Portability

**What is documented?**
Current accessibility implementation status, what has been tested, and what still requires manual validation. Covers keyboard navigation, screen reader support, and low-bandwidth portability.

**Key Topics:**
- Implemented accessibility features in code
- Keyboard navigation patterns
- ARIA labels and semantics
- Low-bandwidth and standards-based portability
- Manual validation checklists
- CI coverage and automated testing

**File:** [accessibility-and-portability.md](accessibility-and-portability.md)

---

### Vue Migration Plan

**What is documented?**
Strategic plan for migrating the frontend from React to Vue, including current state analysis, safe migration order, risks, and acceptance criteria.

**Key Topics:**
- Current architecture and coupling
- Safe decoupling and migration sequence
- Public viewer migration first approach
- Risk assessment and mitigation
- Acceptance criteria for success

**File:** [vue-migration-plan.md](vue-migration-plan.md)

---

## Document Descriptions

### accessibility-and-portability.md

**Purpose:** Document accessibility implementation status and standards compliance for the Claros DPP frontend.

**Topics Covered:**
- Keyboard-operable UI components
- Dialog semantics and ARIA attributes
- Screen reader labels and live regions
- Semantic HTML tables
- Skip links and navigation
- Automated accessibility testing in CI
- Contrast checking
- Low-bandwidth portability
- Standards-based API accessibility
- Manual validation requirements
- Validation checklist
- CI coverage

**Use Cases:**
- Understanding accessibility implementation
- Planning accessibility improvements
- Ensuring WCAG compliance
- Manual accessibility testing
- Validating color contrast
- Testing keyboard navigation

**Status:** Current implementation documented

---

### vue-migration-plan.md

**Purpose:** Strategic plan and technical guidance for migrating the frontend application from React to Vue.

**Topics Covered:**
- Current state analysis
- Application coupling points
- React and Vite current setup
- Public viewer architecture
- Safe decoupling strategy
- Recommended migration order
- Public viewer first approach
- Dashboard and admin migration
- Form screen migration
- Risk analysis and assessment
- Complex form patterns
- Auth/session considerations
- Acceptance criteria for migration

**Use Cases:**
- Planning Vue migration project
- Understanding current architecture
- Identifying decoupling opportunities
- Risk assessment
- Defining migration order
- Setting success criteria
- Managing complex form migration

**Status:** Planning phase

---

## Getting Started

### For Accessibility Testing

**Goal:** Understand and validate accessibility features

**Steps:**
1. Read [accessibility-and-portability.md - What is implemented](accessibility-and-portability.md#what-is-implemented-in-code)
2. Review [Recommended validation checklist](accessibility-and-portability.md#recommended-validation-checklist)
3. Test keyboard navigation through all forms
4. Use screen reader to test dashboard flows
5. Check color contrast with CI reports
6. Run `npm run test:a11y` and `npm run test:contrast` locally

**Related:** [DEVELOPMENT.md](../development/DEVELOPMENT.md#testing)

---

### For Vue Migration Planning

**Goal:** Understand strategy and plan migration work

**Steps:**
1. Read [vue-migration-plan.md - Current state](vue-migration-plan.md#current-state)
2. Review [Safe migration order](vue-migration-plan.md#safe-migration-order)
3. Study [Main risks](vue-migration-plan.md#main-risks)
4. Define [Acceptance criteria](vue-migration-plan.md#recommended-acceptance-criteria)
5. Plan decoupling work for public viewer
6. Create migration task breakdown

**Related:** [DEVELOPMENT.md](../development/DEVELOPMENT.md)

---

## Development Patterns

### Accessibility Patterns

- **Keyboard Navigation:** Accordions, toggles, modals all fully keyboard operable
- **ARIA Semantics:** Proper `aria-expanded`, `aria-controls`, `aria-live` usage
- **Screen Readers:** Semantic labels for close buttons and hidden descriptions
- **Focus Management:** Skip links and proper focus order
- **Automated Testing:** Vitest with Testing Library and axe integration
- **Contrast Checking:** CI contrast validation for all themes

### Frontend Architecture

- **React + Vite:** Current setup for all frontend apps
- **Lazy Loading:** Admin/user/passport pages loaded on demand
- **Shared Components:** Viewer code shared between apps via `@frontend` alias
- **Theme Persistence:** Theme state management across sessions
- **Route Guards:** Authentication-based route protection

### Migration Strategy

- **Freeze Contracts:** Keep URLs and APIs stable
- **Decouple First:** Separate public viewer from React dependencies
- **Public Viewer First:** Lowest-risk migration target
- **Incremental Migration:** Dashboard → Admin → Forms
- **Validate Continuously:** Test at each step

---

## Accessibility Standards

### Implemented Features

✅ Keyboard-operable accordions and toggles  
✅ Dialog semantics for modals  
✅ Screen reader labels and ARIA attributes  
✅ Live regions for feedback  
✅ Semantic table captions  
✅ Skip links to main content  
✅ Automated accessibility tests in CI  
✅ Contrast checking in CI  
✅ Standards-facing HTTPS and JSON APIs  

### Still Requiring Manual Testing

- Screen reader announcement quality across all workflows
- Visible focus order through all tables, modals, and flows
- Color contrast in all themes and branding variants
- Zoom/reflow behavior at 200% and 400%
- Keyboard trap prevention in all modals

---

## Frontend Statistics

| Metric | Value |
|--------|-------|
| Total Frontend Files | 2 |
| Total Lines of Documentation | 200+ |
| Files with Table of Contents | 2/2 (100%) |
| Files with Related Documentation | 2/2 (100%) |
| Total Cross-References | 12 |
| Getting Started Scenarios | 2 |
| Development Patterns | 3 categories |
| Accessibility Features Implemented | 9+ |
| Manual Validation Items | 5 categories |

---

## Related Documentation

### Development & Architecture
- [DEVELOPMENT.md](../development/DEVELOPMENT.md) - Frontend development guidelines
- [DEVELOPMENT_INDEX.md](../development/DEVELOPMENT_INDEX.md) - Development patterns and workflows
- [ARCHITECTURE.md](../architecture/ARCHITECTURE.md) - System architecture
- [SERVICES.md](../architecture/SERVICES.md) - Service dependencies

### Applications
- [frontend-app.md](../apps/frontend-app.md) - Main React frontend application
- [public-passport-viewer.md](../apps/public-passport-viewer.md) - Public viewer application
- [DEVELOPMENT.md](../apps/) - All applications overview

### Security & Access
- [AUTHENTICATION.md](../security/AUTHENTICATION.md) - JWT and RBAC
- [DATA_PROTECTION.md](../security/DATA_PROTECTION.md) - Data security

### Deployment & Infrastructure
- [LOCAL.md](../deployment/LOCAL.md) - Local development setup
- [DOCKER.md](../infrastructure/DOCKER.md) - Docker containerization
- [docker-compose-files.md](../infrastructure/docker-compose-files.md) - Compose configuration

---

**[← Back to Docs](../README.md)**
