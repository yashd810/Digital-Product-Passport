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

  /* ── APP URL — update this for production deployment ──
     Development: React app runs at http://localhost:3000
     Production:  Set to your app domain, e.g. https://app.clarosdpp.com
  ── */
  const APP_LOGIN_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3000/login'
    : '/login'; // Update to full app URL for production (e.g. https://app.clarosdpp.com/login)

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
      <a href="why-dpp.html"      data-page="why-dpp">Why DPP</a>
      <a href="services.html"     data-page="services">Services</a>
      <a href="traceability.html" data-page="traceability">Circularity &amp; Carbon</a>
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
    <a href="why-dpp.html"      data-page="why-dpp">Why DPP</a>
    <a href="services.html"     data-page="services">Services</a>
    <a href="traceability.html" data-page="traceability">Circularity &amp; Carbon</a>
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
            Compliance intelligence for the circular economy. End-to-end Digital Product Passport
            infrastructure, material traceability and circularity workflows, carbon footprint studies,
            and regulatory consulting for companies navigating EU sustainability mandates.
          </p>
          <p class="footer-offices">🌍 Brussels · Milan · Amsterdam · Tokyo · London</p>
        </div>

        <div class="footer-col">
          <h5>Services</h5>
          <ul>
            <li><a href="services.html#platform">DPP Platform</a></li>
            <li><a href="services.html#compliance">Compliance Governance</a></li>
            <li><a href="traceability.html#carbon">Carbon Footprint</a></li>
            <li><a href="traceability.html">Circularity &amp; Material Traceability</a></li>
            <li><a href="services.html#consulting">Regulatory Consulting</a></li>
            <li><a href="traceability.html#circularity">Lifecycle Assessment</a></li>
          </ul>
        </div>

        <div class="footer-col">
          <h5>Regulations</h5>
          <ul>
            <li><a href="timeline.html">ESPR Overview</a></li>
            <li><a href="timeline.html">EU Battery Regulation</a></li>
            <li><a href="timeline.html">Textile DPP 2026</a></li>
            <li><a href="why-dpp.html">REACH &amp; RoHS</a></li>
            <li><a href="why-dpp.html">CSDDD</a></li>
            <li><a href="timeline.html">Full Timeline</a></li>
          </ul>
        </div>

        <div class="footer-col">
          <h5>Company</h5>
          <ul>
            <li><a href="about.html">About ClarosDPP</a></li>
            <li><a href="contact.html">Contact Us</a></li>
            <li><a href="contact.html">Request a Demo</a></li>
            <li><a href="contact.html">Get a Quote</a></li>
            <li><a href="#">Privacy Policy</a></li>
            <li><a href="#">Terms of Service</a></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <p>© 2025 ClarosDPP. All rights reserved. Registered in the European Union.</p>
        <p>hello@clarosdpp.com (update) &nbsp;|&nbsp; +xx xxxx xxxx (update)</p>
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
  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('visible');
          revealObserver.unobserve(e.target); // fire once
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    // observe all .reveal elements already in DOM
    document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

    // also observe any added dynamically (safety net)
    const mutationObs = new MutationObserver(() => {
      document.querySelectorAll('.reveal:not([data-observed])').forEach(el => {
        el.setAttribute('data-observed', '1');
        revealObserver.observe(el);
      });
    });
    mutationObs.observe(document.body, { childList: true, subtree: true });
  } else {
    // Fallback: just show everything
    document.querySelectorAll('.reveal').forEach(el => el.classList.add('visible'));
  }

})();
