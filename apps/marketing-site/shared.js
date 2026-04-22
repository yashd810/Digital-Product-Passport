/* ═══════════════════════════════════════════════
   shared.js
   Injects the navbar, footer, and scroll logic
   into every page. Each HTML page calls:
       <script src="shared.js"></script>
   at the end of <body>.

   HOW IT WORKS:
   - Reads window.location.pathname to mark the
     active nav link automatically.
   - Inserts the navbar at the top of <body>.
   - Inserts the footer at the bottom.
   - Wires up scroll animations (.reveal elements).
   - Wires up the hamburger menu.
   - Adds navbar scroll-shadow effect.
═══════════════════════════════════════════════ */

(function () {
  document.documentElement.setAttribute('data-theme', 'light');
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.setAttribute('content', '#f5f8fb');

  /* ── APP URL ──
     Use localhost during local preview and the live app domain elsewhere.
  ── */
  const APP_LOGIN_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000/login'
    : 'https://app.claros-dpp.online/login';

  /* ── NAV HTML ── */
  const NAV_HTML = `
  <nav class="navbar" id="claros-navbar" role="navigation" aria-label="Main navigation">
    <a href="index.html" class="nav-logo" aria-label="ClarosDPP Home">
      <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="2" y="6" width="22" height="22" rx="4" stroke="#0db5b0" stroke-width="1.8"/>
        <rect x="10" y="2" width="22" height="22" rx="4" fill="rgba(13,181,176,0.1)"
              stroke="#0db5b0" stroke-width="1.6" stroke-dasharray="3 2.5"/>
        <circle cx="13" cy="17" r="3.5" stroke="#0db5b0" stroke-width="1.7"/>
        <path d="M17 17 h8" stroke="#0db5b0" stroke-width="1.7" stroke-linecap="round"/>
        <path d="M7 13 h4" stroke="#0db5b0" stroke-width="1.4" stroke-linecap="round"/>
        <path d="M7 21 h4" stroke="#0db5b0" stroke-width="1.4" stroke-linecap="round"/>
      </svg>
      Claros<span class="accent">DPP</span>
    </a>

    <div class="nav-links" id="nav-desktop">
      <a href="index.html"        data-page="index">Home</a>
      <a href="product.html"      data-page="product">Product</a>
      <a href="services.html"     data-page="services">Services</a>
      <a href="timeline.html"     data-page="timeline">Regulation Timeline</a>
      <a href="about.html"        data-page="about">About</a>
      <a href="contact.html"      data-page="contact" class="nav-cta">Get in Touch</a>
      <a href="${APP_LOGIN_URL}"  class="nav-customer" aria-label="Sign in to your ClarosDPP account">Already a Customer?</a>
    </div>

    <button class="nav-hamburger" id="nav-hamburger"
            aria-label="Toggle navigation menu" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>
  </nav>

  <div class="nav-mobile-menu" id="nav-mobile" role="dialog" aria-label="Mobile navigation">
    <a href="index.html"        data-page="index">Home</a>
    <a href="product.html"      data-page="product">Product</a>
    <a href="services.html"     data-page="services">Services</a>
    <a href="timeline.html"     data-page="timeline">Regulation Timeline</a>
    <a href="about.html"        data-page="about">About</a>
    <a href="contact.html"      data-page="contact" class="nav-cta">Get in Touch</a>
    <a href="${APP_LOGIN_URL}"  class="nav-customer">Already a Customer? →</a>
  </div>`;

  /* ── FOOTER HTML ── */
  const FOOTER_HTML = `
  <footer role="contentinfo">
    <div class="footer-inner">
      <div class="footer-grid">
        <div>
          <a href="index.html" class="nav-logo" style="display:inline-flex;margin-bottom:0.7rem;">
            <svg viewBox="0 0 36 36" fill="none" width="28" height="28" aria-hidden="true">
              <rect x="2" y="6" width="22" height="22" rx="4" stroke="#0db5b0" stroke-width="1.8"/>
              <rect x="10" y="2" width="22" height="22" rx="4" fill="rgba(13,181,176,0.1)"
                    stroke="#0db5b0" stroke-width="1.6" stroke-dasharray="3 2.5"/>
              <circle cx="13" cy="17" r="3.5" stroke="#0db5b0" stroke-width="1.7"/>
              <path d="M17 17 h8" stroke="#0db5b0" stroke-width="1.7" stroke-linecap="round"/>
            </svg>
            Claros<span class="accent">DPP</span>
          </a>
          <p class="footer-brand-desc">
            ClarosDPP combines Digital Product Passport software with compliance governance for ESPR,
            battery, construction, detergent, toy, and other product-specific rules so teams can move
            from scattered data to a market-ready passport programme.
          </p>
        </div>

        <div class="footer-col">
          <h5>Explore</h5>
          <ul>
            <li><a href="index.html">DPP Overview</a></li>
            <li><a href="product.html">Product Platform</a></li>
            <li><a href="services.html">Compliance Governance</a></li>
            <li><a href="timeline.html">Regulation Timeline</a></li>
            <li><a href="sample-passport.html">Sample Passport</a></li>
          </ul>
        </div>

        <div class="footer-col">
          <h5>Regulations</h5>
          <ul>
            <li><a href="timeline.html#direct-regulations">ESPR Overview</a></li>
            <li><a href="timeline.html#direct-regulations">EU Battery Regulation</a></li>
            <li><a href="timeline.html#direct-regulations">Construction Products Regulation</a></li>
            <li><a href="timeline.html#direct-regulations">Detergents Product Passport</a></li>
            <li><a href="timeline.html#direct-regulations">Toy Safety DPP Track</a></li>
            <li><a href="timeline.html">Full Timeline</a></li>
          </ul>
        </div>

        <div class="footer-col">
          <h5>Company</h5>
          <ul>
            <li><a href="about.html">About ClarosDPP</a></li>
            <li><a href="contact.html">Contact Us</a></li>
            <li><a href="product.html">Request a Demo</a></li>
            <li><a href="services.html">Get a Quote</a></li>
            <li><a href="privacy.html">Privacy Policy</a></li>
            <li><a href="terms.html">Terms of Service</a></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <p>© 2025 ClarosDPP. All rights reserved. Registered in the European Union.</p>
        <p>hello@clarosdpp.com &nbsp;|&nbsp; +xx xxxx xxxx</p>
      </div>
    </div>
  </footer>`;

  /* ── INJECT NAVBAR ── */
  const navWrapper = document.createElement('div');
  navWrapper.innerHTML = NAV_HTML;
  document.body.insertBefore(navWrapper, document.body.firstChild);

  /* ── INJECT FOOTER ── */
  const footerWrapper = document.createElement('div');
  footerWrapper.innerHTML = FOOTER_HTML;
  document.body.appendChild(footerWrapper);

  /* ── MARK ACTIVE PAGE ── */
  const path = window.location.pathname;
  const pageName = path.split('/').pop().replace('.html', '') || 'index';
  document.querySelectorAll('[data-page]').forEach(link => {
    if (link.dataset.page === pageName) link.classList.add('active');
  });

  /* ── HAMBURGER TOGGLE ── */
  const hamburger = document.getElementById('nav-hamburger');
  const mobileMenu = document.getElementById('nav-mobile');
  if (hamburger && mobileMenu) {
    hamburger.addEventListener('click', () => {
      const isOpen = mobileMenu.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', isOpen);
    });
    // close on outside click
    document.addEventListener('click', e => {
      if (!hamburger.contains(e.target) && !mobileMenu.contains(e.target)) {
        mobileMenu.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  /* ── NAVBAR SCROLL SHADOW ── */
  const navbar = document.getElementById('claros-navbar');
  if (navbar) {
    window.addEventListener('scroll', () => {
      navbar.classList.toggle('scrolled', window.scrollY > 50);
    }, { passive: true });
  }

  /* ── SCROLL REVEAL ANIMATION ── */

  // Auto-tag every meaningful content block that isn't already animated.
  // Runs in selector-priority order so parent→child conflicts are resolved
  // by the .closest('.reveal') guard before children are processed.
  (function autoReveal() {
    const SKIP_TAGS = new Set(['SCRIPT','STYLE','LINK','META','NOSCRIPT','BR','HR']);
    const SKIP_HOSTS = '#claros-navbar, .nav-mobile-menu, footer';

    // Returns true when the element has at least one DIRECT child with .reveal
    // (meaning the children already handle their own entrance animation).
    function hasRevealChild(el) {
      return Array.from(el.children).some(c => c.classList.contains('reveal'));
    }

    function tag(el) {
      if (!el || SKIP_TAGS.has(el.tagName.toUpperCase())) return;
      if (el.classList.contains('reveal')) return;       // already tagged
      if (el.closest(SKIP_HOSTS)) return;                // nav / footer
      if (el.closest('.reveal')) return;                 // inside animated parent
      if (hasRevealChild(el)) return;                    // children self-animate

      el.classList.add('reveal');

      // Stagger siblings: each sibling adds 80 ms, capped at 320 ms
      const siblings = Array.from(el.parentElement.children)
        .filter(c => !SKIP_TAGS.has(c.tagName.toUpperCase()));
      const idx = siblings.indexOf(el);
      if (idx > 0) el.style.transitionDelay = Math.min(idx * 0.08, 0.32) + 's';
    }

    // ① Top-level content blocks inside every .container
    document.querySelectorAll('.container > *').forEach(tag);

    // ② Hero / split-layout wrappers (not always inside a .container)
    document.querySelectorAll([
      '.hero-inner > *',
      '.hero-grid > *',
      '.hero-layout > *',
      '.bcs-inner > *',
    ].join(', ')).forEach(tag);

    // ③ Children of named layout wrappers (grids, shells, screens, rows)
    //    – processed AFTER ① so .closest('.reveal') catches parents tagged above
    document.querySelectorAll([
      '[class*="-grid"] > *',
      '[class*="-shell"] > *',
      '[class*="-screens"] > *',
      '[class*="-strip"] > *',
      '[class*="-layout"] > *',
      '[class*="-inner"] > *:not(.container)',
    ].join(', ')).forEach(tag);
  })();

  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          revealObserver.unobserve(e.target);
        }
      });
    }, { threshold: 0.07, rootMargin: '0px 0px -24px 0px' });

    // Observe every .reveal element (hand-tagged + auto-tagged)
    document.querySelectorAll('.reveal').forEach(el => {
      if (!el.closest('#claros-navbar, .nav-mobile-menu, footer')) {
        revealObserver.observe(el);
      }
    });

    // Watch for elements added dynamically (nav/footer injection)
    const mutationObs = new MutationObserver(() => {
      document.querySelectorAll('.reveal:not([data-observed])').forEach(el => {
        if (el.closest('#claros-navbar, .nav-mobile-menu, footer')) return;
        el.setAttribute('data-observed', '1');
        revealObserver.observe(el);
      });
    });
    mutationObs.observe(document.body, { childList: true, subtree: true });
  } else {
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
  }

})();
