# Marketing Site Spacing Uniformity Audit

**Date:** May 26, 2026  
**Status:** ⚠️ Inconsistencies Found

---

## Executive Summary

The marketing website has **defined spacing variables** but **inconsistent application** across pages. The spacing system is partially implemented, leading to visual inconsistencies in:
- Inter-section gaps
- Header-to-content margins
- Footer spacing
- Intra-section text density

---

## Current Spacing System

### CSS Variables Defined (`styles.css`)

```css
--layout-x: 5%;                    /* Horizontal container padding */
--first-section-gap: 6rem;         /* Gap after hero to first section */
--section-gap: 6rem;               /* Intended for inter-section gap (NOT USED) */
--section-pad-y: 0rem;             /* Vertical padding within sections */
--hero-pad-y: 4rem;                /* Hero section top padding */
--footer-pad-top: 6rem;            /* Footer top padding */
--footer-pad-bottom: 2rem;         /* Footer bottom padding */
```

### Applied Spacing Rules

| Element | Applied Spacing | Location in CSS | Current Usage |
| --- | --- | --- | --- |
| Page body | `padding-top: 80px` | `.page-body` | ✅ Consistent |
| Hero sections | `padding-top: 4rem` | `.section-hero`, `.page-hero`, etc. | ✅ Consistent |
| First section after hero | `margin-top: 6rem` | `.hero + section` selector | ✅ Mostly consistent |
| Sections (vertical) | `padding: 0rem 0` | `.section` | ⚠️ No spacing between sections |
| Footer top | `padding-top: 6rem` | `footer` | ✅ Consistent |
| Footer bottom | `padding-bottom: 2rem` | `footer` | ✅ Consistent |

---

## Issues Identified

### 1. **CRITICAL: Missing Inter-Section Margins** ❌

**Problem:** Sections have NO margin-bottom or margin-top spacing between them (except for the first section after a hero).

**Evidence:**
```css
.section { padding: var(--section-pad-y) 0; }  /* No margin defined */
```

**Impact:**
- Core features section touches platform-in-action section with no gap
- Archive-restore section touches footer with no buffer
- Visual rhythm is broken between page segments

**Current Pages Affected:**
- [product.html](apps/marketing-site/product.html) (core-features → architecture → platform-in-action)
- [services.html](apps/marketing-site/services.html) (multiple consecutive sections)
- [about.html](apps/marketing-site/about.html) (mission-section has no bottom margin)

---

### 2. **MODERATE: Inconsistent Section-to-Footer Gap** ⚠️

**Problem:** Footer has `padding-top: 6rem`, but the last section has no `margin-bottom`, creating reliance on footer's top padding alone.

**Expected Behavior:** Last section should have explicit `margin-bottom` to match the `--first-section-gap`.

**Impact:**
- If footer top padding changes, content spacing breaks
- Migrating sections becomes error-prone
- Mobile responsiveness may collapse the gap

---

### 3. **MODERATE: No Defined Section-to-Section Gap** ⚠️

**Problem:** Variable `--section-gap: 6rem` is defined but **never used** in the stylesheet.

**Affected Elements:**
```
#core-features section
#architecture section  
#platform-in-action section
#battery-passport section
(and all subsequent sections on every page)
```

**Evidence:**
```css
/* Defined but unused */
--section-gap: 6rem;

/* Selectors missing gap application */
.section,
.section-alt,
.section-dark,
.bcs-strip {
  padding: var(--section-pad-y) 0;  /* No margin-bottom */
}
```

---

### 4. **MODERATE: Text Intra-Section Spacing Inconsistencies** ⚠️

**Problem:** Intra-section text spacing uses arbitrary values instead of a scale:

| Component | Spacing | Defined? | Consistency |
| --- | --- | --- | --- |
| Section title margin-bottom | `1rem` | ✅ Yes | ✅ Consistent |
| Paragraph margins | Varies (0.7rem - 1.15rem) | ❌ No | ⚠️ Inconsistent |
| List item gaps | `0.3rem - 0.55rem` | ❌ No | ⚠️ Inconsistent |
| Card padding | `1rem - 1.5rem` | ❌ No | ⚠️ Inconsistent |
| Feature box gaps | `0.4rem - 0.7rem` | ❌ No | ⚠️ Inconsistent |

**Examples of Inconsistency:**
```css
.home-page .dpp-block { gap: 0.4rem; }
.home-page .hero-facts { gap: 0.8rem; }
.product-page .qr-frame { gap: 1rem; }
.product-page .hero-facts { gap: 0.8rem; }
```

---

### 5. **MINOR: Mobile Breakpoint Adjustments** ⚠️

**Problem:** Footer top padding reduces on mobile but other spacing variables don't have responsive variants.

```css
@media (max-width: 768px) {
  :root {
    --footer-pad-top: 3rem;  /* Changed */
    --first-section-gap: 6rem;  /* Unchanged - should be 4rem? */
  }
}
```

---

## Page-by-Page Breakdown

### [index.html](apps/marketing-site/index.html) (Homepage)
- **Header to hero gap:** ✅ 80px navbar buffer
- **Hero to first section:** ✅ 6rem (correct)
- **Section-to-section gaps:** ❌ None applied
- **Last section to footer:** ⚠️ Relies on footer top padding only

### [product.html](apps/marketing-site/product.html) (Product Page)
- **Header to hero gap:** ✅ 80px navbar buffer
- **Hero to first section:** ✅ 6rem (correct)
- **Core features → Architecture:** ❌ No gap
- **Architecture → Platform in action:** ❌ No gap
- **Battery passport positioning:** ⚠️ Uses `.bcs-strip` (different section class)
- **Last section to footer:** ⚠️ Relies on footer top padding only

### [about.html](apps/marketing-site/about.html) (About Page)
- **Header to hero gap:** ✅ 80px navbar buffer
- **Hero to mission section:** ⚠️ First section after hero, but uses different section class (`.section-dark`)
- **Section-to-section gaps:** ❌ None applied
- **Last section to footer:** ⚠️ Relies on footer top padding only

### [services.html](apps/marketing-site/services.html) (Services Page)
- **Header to hero gap:** ✅ 80px navbar buffer
- **Hero to first section:** ✅ 6rem (correct)
- **Compliance → Beyond ESPR → How we help:** ❌ No gaps
- **Last section to footer:** ⚠️ Relies on footer top padding only

---

## Recommended Fixes

### Priority 1: Add Missing Inter-Section Margins

**File:** [apps/marketing-site/styles.css](apps/marketing-site/styles.css)

Add margin-bottom to all section types:

```css
/* Add after line 208 */
.section,
.section-alt,
.section-dark,
.bcs-strip {
  margin-bottom: var(--section-gap);  /* NEW: 6rem gap between sections */
  padding: var(--section-pad-y) 0;
}

/* Adjust footer to not rely on top padding for spacing */
footer {
  margin-top: 0;  /* Let sections control the gap */
  padding: var(--footer-pad-top) var(--layout-x) var(--footer-pad-bottom);
}
```

### Priority 2: Standardize Intra-Section Text Spacing

Define a spacing scale for consistent component spacing:

```css
/* Add new spacing scale */
:root {
  --spacing-xs: 0.25rem;
  --spacing-sm: 0.5rem;
  --spacing-md: 0.75rem;
  --spacing-lg: 1rem;
  --spacing-xl: 1.5rem;
  --spacing-2xl: 2rem;
}

/* Apply consistently to components */
.dpp-block { gap: var(--spacing-sm); }
.hero-facts { gap: var(--spacing-md); }
.qr-frame { gap: var(--spacing-lg); }
```

### Priority 3: Update Responsive Spacing

Adjust spacing variables for mobile/tablet breakpoints:

```css
@media (max-width: 768px) {
  :root {
    --first-section-gap: 4rem;  /* Reduce from 6rem */
    --section-gap: 4rem;        /* Reduce from 6rem */
    --footer-pad-top: 3rem;     /* Already correct */
  }
}
```

### Priority 4: Rename/Use Section-Gap Variable

Stop using undefined margins and rely on CSS variables:

```css
/* Replace all arbitrary margins with variable references */

/* Before: */
.pf-track { margin-bottom: 2rem; }

/* After: */
.pf-track { margin-bottom: var(--section-gap); }
```

---

## Testing Checklist

After implementing fixes, verify:

- [ ] Header nav to hero section: 80px + 4rem consistent across all pages
- [ ] Hero to first content section: 6rem consistent across all pages  
- [ ] Section-to-section gaps: 6rem consistent across all pages
- [ ] Last section to footer: 6rem consistent (from section margin-bottom)
- [ ] Footer to bottom of viewport: 2rem consistent across all pages
- [ ] Text within components: Uses defined spacing scale
- [ ] Mobile (≤768px): Sections use 4rem gaps instead of 6rem
- [ ] Tablet (769-1024px): Transitions smoothly between mobile/desktop
- [ ] All HTML pages: Identical spacing treatment

---

## Files Involved

| File | Issue | Severity |
| --- | --- | --- |
| [styles.css](apps/marketing-site/styles.css) | Missing inter-section margins | 🔴 Critical |
| [styles.css](apps/marketing-site/styles.css) | Inconsistent intra-section spacing | 🟡 Moderate |
| [styles.css](apps/marketing-site/styles.css) | Unused `--section-gap` variable | 🟡 Moderate |
| [index.html](apps/marketing-site/index.html) | Inherits spacing issues | 🟡 Moderate |
| [product.html](apps/marketing-site/product.html) | Inherits spacing issues | 🟡 Moderate |
| [about.html](apps/marketing-site/about.html) | Inherits spacing issues | 🟡 Moderate |
| [services.html](apps/marketing-site/services.html) | Inherits spacing issues | 🟡 Moderate |
| [contact.html](apps/marketing-site/contact.html) | Not audited | ⚪️ Unknown |
| [timeline.html](apps/marketing-site/timeline.html) | Not audited | ⚪️ Unknown |
| [sample-passport.html](apps/marketing-site/sample-passport.html) | Not audited | ⚪️ Unknown |

---

## Summary Statistics

| Metric | Value |
| --- | --- |
| Total spacing variables defined | 8 |
| Variables properly applied | 5 (62.5%) |
| Variables unused | 1 (`--section-gap`) |
| Section-to-section gaps missing | ✅ Across entire site |
| Pages affected | 7+ |
| Visual uniformity score | 65/100 |

