# Marketing Site

Static HTML/CSS marketing website for Claros Digital Product Passport platform.

---

## Quick Start

```bash
# Development server (port 8080)
python -m http.server 8080

# Or with npm
cd apps/marketing-site
npm install -g http-server
http-server -p 8080

# Production with Nginx
docker-compose up marketing-site
```

**Access**: http://localhost:8080

---

## Overview

### Purpose

Marketing Site provides public-facing information about the Claros DPP platform, including:
- Product overview
- Features and benefits
- Pricing information
- Company information
- Legal documents (Privacy Policy, Terms of Service)
- Blog/news
- Contact information

### Key Features

- **Static Content**: Fast loading, SEO-friendly
- **Responsive Design**: Works on all devices
- **Legal Compliance**: Privacy policy, terms of service
- **Performance**: Optimized for speed
- **SEO**: Structured data, meta tags
- **Accessibility**: WCAG compliant

---

## Directory Structure

```
apps/marketing-site/
├── index.html                 # Home page
├── about.html                 # About page
├── product.html               # Product page
├── services.html              # Services page
├── contact.html               # Contact page
├── privacy-policy.html        # Privacy policy
├── terms-of-service.html      # Terms of service
├── sample-passport.html       # Demo/sample
├── styles.css                 # Main stylesheet
├── shared.js                  # Shared JavaScript
├── robots.txt                 # SEO
├── sitemap.xml                # SEO
├── site.webmanifest          # PWA manifest
├── assets/                    # Images, fonts, etc.
│   ├── images/
│   ├── icons/
│   └── fonts/
├── Dockerfile
├── nginx.conf                 # Nginx configuration
└── README.md
```

---

## Pages

### Home (index.html)

Landing page with:
- Hero section
- Features overview
- Call-to-action
- Testimonials
- Footer with links

### About (about.html)

Company information:
- Mission statement
- Company history
- Team information
- Contact details

### Product (product.html)

Product overview:
- Features
- Use cases
- Technical specifications
- Pricing
- Demo link

### Services (services.html)

Service offerings:
- Consulting
- Implementation
- Training
- Support

### Contact (contact.html)

Contact form with:
- Name, email, message fields
- Company/organization field
- Subject selection
- Form validation
- Submission handling

### Privacy Policy (privacy-policy.html)

Legal document covering:
- Data collection practices
- Privacy rights
- Cookie usage
- GDPR compliance
- Contact for privacy concerns

### Terms of Service (terms-of-service.html)

Legal document covering:
- Acceptable use
- Intellectual property
- Limitations of liability
- Dispute resolution
- Terms modification

---

## HTML Structure

### Basic Page Template

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Claros DPP - Digital Product Passport Platform">
  <title>Claros DPP</title>
  
  <!-- Stylesheets -->
  <link rel="stylesheet" href="styles.css">
  
  <!-- Open Graph / Social Media -->
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://claros-dpp.online/">
  <meta property="og:title" content="Claros DPP">
  <meta property="og:description" content="Digital Product Passport Platform">
  <meta property="og:image" content="https://claros-dpp.online/assets/og-image.png">
  
  <!-- Favicon -->
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
</head>
<body>
  <!-- Navigation -->
  <nav class="navbar">
    <div class="container">
      <a href="/" class="logo">Claros DPP</a>
      <ul class="nav-menu">
        <li><a href="/index.html">Home</a></li>
        <li><a href="/product.html">Product</a></li>
        <li><a href="/services.html">Services</a></li>
        <li><a href="/about.html">About</a></li>
        <li><a href="/contact.html">Contact</a></li>
      </ul>
    </div>
  </nav>
  
  <!-- Main Content -->
  <main>
    <!-- Page content -->
  </main>
  
  <!-- Footer -->
  <footer class="footer">
    <div class="container">
      <div class="footer-content">
        <div class="footer-section">
          <h3>Claros DPP</h3>
          <ul>
            <li><a href="/">Home</a></li>
            <li><a href="/product.html">Product</a></li>
            <li><a href="/about.html">About</a></li>
          </ul>
        </div>
        <div class="footer-section">
          <h3>Legal</h3>
          <ul>
            <li><a href="/privacy-policy.html">Privacy Policy</a></li>
            <li><a href="/terms-of-service.html">Terms of Service</a></li>
          </ul>
        </div>
        <div class="footer-section">
          <h3>Contact</h3>
          <ul>
            <li><a href="mailto:info@claros-dpp.online">Email</a></li>
            <li><a href="/contact.html">Contact Form</a></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <p>&copy; 2024 Claros DPP. All rights reserved.</p>
      </div>
    </div>
  </footer>
  
  <!-- Scripts -->
  <script src="shared.js"></script>
</body>
</html>
```

---

## Styling (CSS)

### Color Scheme

```css
:root {
  --primary-color: #0066cc;
  --secondary-color: #00cc99;
  --accent-color: #ff6600;
  --text-color: #333333;
  --light-bg: #f5f5f5;
  --border-color: #e0e0e0;
  --success-color: #28a745;
  --error-color: #dc3545;
}
```

### Responsive Design

```css
/* Mobile first approach */

/* Tablets */
@media (min-width: 768px) {
  .container {
    max-width: 750px;
  }
}

/* Desktop */
@media (min-width: 1024px) {
  .container {
    max-width: 960px;
  }
}

/* Large screens */
@media (min-width: 1440px) {
  .container {
    max-width: 1140px;
  }
}
```

---

## JavaScript (shared.js)

### Navigation

```javascript
// Mobile menu toggle
document.addEventListener('DOMContentLoaded', () => {
  const menuButton = document.querySelector('.menu-button');
  const navMenu = document.querySelector('.nav-menu');
  
  if (menuButton) {
    menuButton.addEventListener('click', () => {
      navMenu.classList.toggle('active');
    });
  }
});

// Smooth scrolling
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function(e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
});
```

### Form Validation

```javascript
function validateContactForm() {
  const form = document.getElementById('contact-form');
  if (!form) return;
  
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const name = form.querySelector('[name="name"]').value.trim();
    const email = form.querySelector('[name="email"]').value.trim();
    const message = form.querySelector('[name="message"]').value.trim();
    
    // Validate
    if (!name || !email || !message) {
      alert('Please fill in all fields');
      return;
    }
    
    if (!isValidEmail(email)) {
      alert('Please enter a valid email');
      return;
    }
    
    // Submit
    console.log({ name, email, message });
    // Send to backend or email service
    form.reset();
    alert('Thank you for contacting us!');
  });
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

validateContactForm();
```

---

## Performance Optimization

### Image Optimization

```html
<!-- Use modern image formats -->
<picture>
  <source srcset="/assets/hero.webp" type="image/webp">
  <img src="/assets/hero.jpg" alt="Hero image" loading="lazy">
</picture>

<!-- Lazy loading -->
<img src="image.jpg" loading="lazy" alt="Description">
```

### Caching

```html
<!-- Cache busting for CSS/JS -->
<link rel="stylesheet" href="/styles.css?v=1.0.0">
<script src="/shared.js?v=1.0.0"></script>
```

### Minification

```bash
# Minify CSS
npx cssnano styles.css > styles.min.css

# Minify JavaScript
npx terser shared.js > shared.min.js

# Minify HTML
npx html-minifier index.html > index.min.html
```

---

## SEO

### Meta Tags

```html
<meta name="description" content="Claros DPP - Digital Product Passport Platform">
<meta name="keywords" content="digital passport, battery, recycling, compliance">
<meta name="author" content="Claros">
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<!-- Open Graph -->
<meta property="og:title" content="Claros DPP">
<meta property="og:description" content="...">
<meta property="og:image" content="...">

<!-- Twitter Card -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Claros DPP">
```

### Sitemap (sitemap.xml)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://claros-dpp.online/</loc>
    <lastmod>2024-01-15</lastmod>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://claros-dpp.online/product.html</loc>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://claros-dpp.online/about.html</loc>
    <priority>0.7</priority>
  </url>
</urlset>
```

### Robots.txt

```
User-agent: *
Allow: /
Disallow: /admin/
Disallow: /private/

Sitemap: https://claros-dpp.online/sitemap.xml
```

---

## Accessibility

### WCAG Compliance

```html
<!-- Alt text for images -->
<img src="image.jpg" alt="Descriptive text">

<!-- Semantic HTML -->
<header>...</header>
<nav>...</nav>
<main>...</main>
<footer>...</footer>

<!-- Headings hierarchy -->
<h1>Main Title</h1>
<h2>Section</h2>
<h3>Subsection</h3>

<!-- Proper form labels -->
<label for="email">Email:</label>
<input id="email" type="email" name="email">

<!-- ARIA attributes where needed -->
<button aria-label="Close menu">×</button>
```

---

## Deployment

### Docker

```dockerfile
FROM nginxinc/nginx-unprivileged:1.27-alpine

COPY . /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
```

### Docker Compose

```yaml
services:
  marketing-site:
    build: ./apps/marketing-site
    ports:
      - "8080:8080"
    volumes:
      - ./apps/marketing-site:/usr/share/nginx/html
    restart: unless-stopped
```

### Nginx Configuration

```nginx
server {
  listen 8080;
  server_name _;
  
  root /usr/share/nginx/html;
  index index.html;
  
  # Cache static assets
  location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }
  
  # Serve index.html for routes
  location / {
    try_files $uri $uri/ /index.html;
  }
  
  # Disable caching for HTML
  location ~* \.html?$ {
    expires -1;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
  }
}
```

---

## Monitoring

### Analytics

```html
<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=GA_ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'GA_ID');
</script>
```

---

**[← Back to Main Docs](../../README.md)**
