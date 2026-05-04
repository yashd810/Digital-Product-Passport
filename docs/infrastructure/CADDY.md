# Caddy Reverse Proxy Configuration Guide

Complete guide to configuring Caddy as a reverse proxy for the Claros DPP platform, including SSL/TLS, routing rules, and production deployment.

---

## Table of Contents

1. [Caddy Overview](#caddy-overview)
2. [Installation](#installation)
3. [Configuration Basics](#configuration-basics)
4. [SSL/TLS Setup](#ssltls-setup)
5. [Routing Configuration](#routing-configuration)
6. [Virtual Hosts](#virtual-hosts)
7. [Load Balancing](#load-balancing)
8. [Caching & Performance](#caching--performance)
9. [Logging](#logging)
10. [Troubleshooting](#troubleshooting)

---

## Caddy Overview

### What is Caddy?

Caddy is a modern web server and reverse proxy with:
- **Automatic HTTPS**: Free SSL/TLS certificates via Let's Encrypt
- **Simple Config**: Human-readable configuration syntax
- **JSON API**: Programmatic configuration
- **Plugin System**: Extensible architecture

### Why Caddy for Claros DPP?

- Automatic certificate renewal (no manual management)
- Zero-downtime reloads
- HTTP/2 support
- Reverse proxy for microservices
- Built-in compression
- Rate limiting
- Authentication support

### Caddy vs Others

| Feature | Caddy | Nginx | Apache |
|---------|-------|-------|--------|
| Automatic HTTPS | ✅ | ❌ | ❌ |
| Config Format | Easy | Complex | Complex |
| Performance | Excellent | Excellent | Good |
| Learning Curve | Easy | Medium | Hard |
| Hot Reload | ✅ | ❌ | ✅ |

---

## Installation

### On Ubuntu/Linux (OCI Production)

**Install Caddy**:
```bash
# Download
wget https://github.com/caddyserver/caddy/releases/download/v2.7.6/caddy_2.7.6_linux_amd64.tar.gz

# Extract
tar -xzf caddy_2.7.6_linux_amd64.tar.gz

# Move to path
sudo mv caddy /usr/local/bin/

# Verify
caddy version
```

**Or using package manager**:
```bash
# Add repository
echo "deb [trusted=yes] https://dl.caddy.community/linux/debian any main" | sudo tee /etc/apt/sources.list.d/caddy-debian.list

# Install
sudo apt-get update
sudo apt-get install -y caddy

# Verify
caddy version
```

### Docker

```bash
# Run Caddy in Docker
docker run -d \
  --name caddy \
  -p 80:80 \
  -p 443:443 \
  -v /path/to/Caddyfile:/etc/caddy/Caddyfile \
  -v caddy_data:/data \
  caddy:2-alpine
```

### macOS

```bash
# Using Homebrew
brew install caddy

# Verify
caddy version
```

---

## Configuration Basics

### Caddyfile Format

Simple, human-readable syntax:

```caddyfile
# Comments start with #

# Basic reverse proxy
example.com {
  reverse_proxy localhost:3001
}

# With subdomains
api.example.com {
  reverse_proxy localhost:3001
}

www.example.com {
  reverse_proxy localhost:3000
}
```

### Common Directives

```caddyfile
# Reverse proxy to backend
reverse_proxy localhost:3001

# Static file serving
file_server

# Rewrite URL
rewrite /old /new

# Header manipulation
header X-Custom-Header "value"

# Compression
encode gzip

# Redirect
redir /old /new

# Basic auth
basicauth /admin * {
  user1 hashedpassword
}

# Rate limiting
rate_limit {
  zone static {
    key static
    events 100
    window 1m
  }
}
```

---

## SSL/TLS Setup

### Automatic HTTPS

Caddy automatically provisions free HTTPS certificates from Let's Encrypt:

```caddyfile
claros-dpp.online {
  reverse_proxy localhost:3001
}
```

**Requirements**:
- Valid domain name (DNS pointing to server)
- Port 80 and 443 accessible
- Email for certificate notifications (optional)

### Manual Certificate

Using your own certificate:

```caddyfile
claros-dpp.online {
  # Specify certificate files
  tls /path/to/cert.pem /path/to/key.pem
  reverse_proxy localhost:3001
}
```

### Self-Signed Certificate (Development)

```bash
# Generate self-signed certificate
caddy trust
caddy untrust
```

In Caddyfile:
```caddyfile
:443 {
  tls internal
  reverse_proxy localhost:3001
}
```

### Certificate Renewal

Caddy automatically renews certificates before expiration:

```bash
# Check certificate status
caddy list-certificates

# Manual renewal (if needed)
caddy reload
```

### HTTPS Enforcement

```caddyfile
http:// {
  # Redirect HTTP to HTTPS
  redir https://{host}{uri}
}

https:// {
  reverse_proxy localhost:3001
}
```

---

## Routing Configuration

### Basic Routing

Route based on domain and path:

```caddyfile
# Frontend
claros-dpp.online {
  reverse_proxy localhost:3000
}

# API
api.claros-dpp.online {
  reverse_proxy localhost:3001
}

# Public viewer
viewer.claros-dpp.online {
  reverse_proxy localhost:3004
}
```

### Path-Based Routing

```caddyfile
claros-dpp.online {
  # Frontend (default)
  reverse_proxy / localhost:3000

  # API
  reverse_proxy /api/* localhost:3001

  # Public viewer
  reverse_proxy /viewer/* localhost:3004
}
```

### Rewrite Rules

```caddyfile
claros-dpp.online {
  # Rewrite paths before proxying
  rewrite /old-api/* /new-api/{path}
  rewrite /static/* /assets/{path}

  reverse_proxy localhost:3000
}
```

### Conditional Routing

```caddyfile
claros-dpp.online {
  # Route based on method
  @get method GET
  @post method POST

  # Route based on header
  @admin header Authorization "Bearer admin-token"

  # Route based on path
  @api path /api/*

  # Apply routing rules
  handle @api {
    reverse_proxy localhost:3001
  }

  handle @admin {
    reverse_proxy localhost:8080
  }

  handle {
    reverse_proxy localhost:3000
  }
}
```

---

## Virtual Hosts

### Multiple Domains

```caddyfile
# Main domain
claros-dpp.online {
  reverse_proxy localhost:3000
}

# Subdomain for API
api.claros-dpp.online {
  reverse_proxy localhost:3001
}

# Subdomain for admin
admin.claros-dpp.online {
  reverse_proxy localhost:8080
}
```

### Wildcard Subdomains

```caddyfile
*.claros-dpp.online {
  reverse_proxy localhost:3000
}

# Or specific pattern
{host}.data.claros-dpp.online {
  reverse_proxy localhost:3002
}
```

### Alias Domains

```caddyfile
claros-dpp.online, www.claros-dpp.online {
  reverse_proxy localhost:3000
}
```

---

## Load Balancing

### Multiple Backend Servers

```caddyfile
claros-dpp.online {
  reverse_proxy localhost:3001 localhost:3002 localhost:3003 {
    policy round_robin
  }
}
```

### Load Balancing Policies

```caddyfile
claros-dpp.online {
  reverse_proxy localhost:3001 localhost:3002 {
    # Round robin (default)
    policy round_robin

    # Least connections
    policy least_conn

    # Random
    policy random

    # URI hash
    policy uri_hash

    # Header hash
    policy header_hash X-User-ID

    # IP hash
    policy ip_hash

    # Fastest response
    policy fastest
  }
}
```

### Health Checks

```caddyfile
claros-dpp.online {
  reverse_proxy localhost:3001 localhost:3002 {
    policy round_robin

    # Health check
    health_uri /api/health
    health_interval 10s
    health_timeout 5s
  }
}
```

---

## Caching & Performance

### Response Caching

```caddyfile
claros-dpp.online {
  # Cache static assets
  @static {
    path *.js *.css *.png *.jpg *.ico
  }

  handle @static {
    header Cache-Control "public, max-age=31536000"
    reverse_proxy localhost:3000
  }

  # Don't cache API
  @api path /api/*
  handle @api {
    header Cache-Control "no-cache, no-store"
    reverse_proxy localhost:3001
  }
}
```

### Compression

```caddyfile
claros-dpp.online {
  # Enable compression
  encode gzip

  reverse_proxy localhost:3000
}
```

### Connection Settings

```caddyfile
claros-dpp.online {
  reverse_proxy localhost:3000 {
    # Keep-alive
    keepalive 10

    # Request timeout
    timeout 30s

    # Header timeout
    header_timeout 10s

    # Request size limit
    max_requests 100
  }
}
```

---

## Logging

### Access Logging

```caddyfile
claros-dpp.online {
  log {
    output file /var/log/caddy/access.log
    format json
  }

  reverse_proxy localhost:3000
}
```

### Log Levels

```caddyfile
{
  log default {
    level debug  # or info, warn, error
    output file /var/log/caddy/debug.log
  }
}

claros-dpp.online {
  reverse_proxy localhost:3000
}
```

### Log Rotation

```caddyfile
claros-dpp.online {
  log {
    output file /var/log/caddy/access.log {
      roll_size 100mb
      roll_keep 5
      roll_keep_for 720h
    }
  }

  reverse_proxy localhost:3000
}
```

### View Logs

```bash
# Real-time logs
tail -f /var/log/caddy/access.log

# JSON formatted logs
cat /var/log/caddy/access.log | jq
```

---

## Production Caddyfile Example

Complete Caddyfile for production:

```caddyfile
# Global options
{
  # Automatic HTTPS
  auto_https on

  # Email for Let's Encrypt
  email contact@claros-dpp.online

  # Admin API
  admin localhost:2019

  # Logging
  log default {
    output file /var/log/caddy/access.log {
      roll_size 100mb
      roll_keep 5
      roll_keep_for 720h
    }
    format json
  }
}

# Main domain
claros-dpp.online, www.claros-dpp.online {
  # Redirect www to non-www
  redir /www.claros-dpp.online https://claros-dpp.online{uri} permanent

  # Static files
  @static {
    path *.js *.css *.png *.jpg *.ico *.woff *.woff2
  }

  handle @static {
    header Cache-Control "public, max-age=31536000, immutable"
    header -Server
    encode gzip
    reverse_proxy localhost:3000
  }

  # API routes
  @api path /api/*
  handle @api {
    header Cache-Control "no-cache, no-store"
    header -Server
    encode gzip
    reverse_proxy localhost:3001 {
      header_up X-Forwarded-For {http.request.header.X-Forwarded-For}
      header_up X-Forwarded-Proto "https"
      header_up Host {http.request.host}
    }
  }

  # Health check endpoint
  @health path /api/health
  handle @health {
    reverse_proxy localhost:3001
  }

  # Everything else to frontend
  handle {
    header Cache-Control "no-cache"
    header -Server
    encode gzip
    reverse_proxy localhost:3000 {
      header_up X-Forwarded-For {http.request.header.X-Forwarded-For}
      header_up X-Forwarded-Proto "https"
      header_up Host {http.request.host}
    }
  }
}

# Public viewer subdomain
viewer.claros-dpp.online {
  header Cache-Control "public, max-age=3600"
  header -Server
  encode gzip

  @api path /api/*
  handle @api {
    header Cache-Control "no-cache, no-store"
    reverse_proxy localhost:3001
  }

  handle {
    reverse_proxy localhost:3004 {
      header_up X-Forwarded-For {http.request.header.X-Forwarded-For}
      header_up X-Forwarded-Proto "https"
      header_up Host {http.request.host}
    }
  }
}

# API subdomain
api.claros-dpp.online {
  header -Server
  encode gzip

  reverse_proxy localhost:3001 {
    header_up X-Forwarded-For {http.request.header.X-Forwarded-For}
    header_up X-Forwarded-Proto "https"
    header_up Host {http.request.host}
  }
}
```

---

## Systemd Configuration

### Create Service File

```bash
sudo nano /etc/systemd/system/caddy.service
```

**Content**:
```ini
[Unit]
Description=Caddy Reverse Proxy
Documentation=https://caddyserver.com/docs/
After=network.target

[Service]
Type=notify
User=caddy
Group=caddy
ExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile
TimeoutStopSec=5s
LimitNOFILE=1048576
LimitNPROC=512

[Install]
WantedBy=multi-user.target
```

### Start Caddy

```bash
# Enable on boot
sudo systemctl enable caddy

# Start service
sudo systemctl start caddy

# Check status
sudo systemctl status caddy

# View logs
sudo journalctl -u caddy -f
```

---

## Troubleshooting

### Certificate Issues

**Certificate not generating**:
```bash
# Check permissions
sudo chown -R caddy:caddy /var/lib/caddy

# Check port accessibility
sudo netstat -tlnp | grep :80
sudo netstat -tlnp | grep :443

# Check DNS
dig claros-dpp.online
nslookup claros-dpp.online
```

### Service Won't Start

**Check syntax**:
```bash
# Validate Caddyfile
caddy validate --config /etc/caddy/Caddyfile
```

**View error logs**:
```bash
# Systemd logs
sudo journalctl -u caddy -n 50

# Caddy logs
cat /var/log/caddy/access.log
```

### Reverse Proxy Not Working

**Test connectivity**:
```bash
# Check if backend is running
curl http://localhost:3001

# Check DNS resolution
dig claros-dpp.online

# Test through Caddy
curl https://claros-dpp.online
```

**Check Caddyfile**:
```bash
# Validate syntax
caddy validate

# View current config
caddy config
```

### Performance Issues

**Check resource usage**:
```bash
# CPU and memory
ps aux | grep caddy

# Connection count
netstat -an | grep ESTABLISHED | wc -l
```

**Optimize**:
```caddyfile
claros-dpp.online {
  reverse_proxy localhost:3001 {
    # Increase connections
    keepalive 100

    # Adjust timeout
    timeout 60s
  }
}
```

### HTTPS Issues

**Redirect loop**:
```bash
# Check for multiple redirect rules
grep redir /etc/caddy/Caddyfile

# Test redirects
curl -I http://claros-dpp.online
curl -I https://claros-dpp.online
```

**Mixed content warning**:
```bash
# Ensure all content is served over HTTPS
# Check browser console for mixed content warnings
```

---

## Best Practices

### Security

- ✅ Use HTTPS for all traffic
- ✅ Set security headers
- ✅ Enable HTTP Strict Transport Security (HSTS)
- ✅ Limit request size
- ✅ Use rate limiting

### Performance

- ✅ Enable compression
- ✅ Set appropriate cache headers
- ✅ Use keep-alive connections
- ✅ Load balance across backends
- ✅ Monitor resource usage

### Reliability

- ✅ Configure health checks
- ✅ Set reasonable timeouts
- ✅ Enable logging
- ✅ Monitor certificate expiration
- ✅ Plan for failover

### Monitoring

- ✅ Check access logs regularly
- ✅ Monitor certificate status
- ✅ Track response times
- ✅ Alert on errors
- ✅ Review security headers

---

## Security Headers

Add security headers for better protection:

```caddyfile
claros-dpp.online {
  # HSTS
  header Strict-Transport-Security "max-age=31536000; includeSubDomains"

  # Prevent clickjacking
  header X-Frame-Options "SAMEORIGIN"

  # Prevent MIME sniffing
  header X-Content-Type-Options "nosniff"

  # XSS protection
  header X-XSS-Protection "1; mode=block"

  # CSP
  header Content-Security-Policy "default-src 'self'"

  # Referrer policy
  header Referrer-Policy "strict-origin-when-cross-origin"

  reverse_proxy localhost:3000
}
```

---

**[← Back to Infrastructure Docs](../README.md) | [Next: Database Management →](./DATABASE.md)**
