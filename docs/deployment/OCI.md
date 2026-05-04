# OCI Production Deployment - Claros DPP

Complete guide for deploying Claros DPP to Oracle Cloud Infrastructure (OCI).

---

## Overview

Production deployment uses:
- **Cloud Provider**: Oracle Cloud Infrastructure (OCI)
- **Instance Type**: Ubuntu 24.04.4 LTS VM
- **Reverse Proxy**: Caddy (handles SSL/TLS)
- **Containerization**: Docker & Docker Compose
- **Database**: PostgreSQL in container
- **Domain**: claros-dpp.online

---

## Architecture

```
Internet (0.0.0.0:80, :443)
    ↓
Caddy Reverse Proxy (SSL/TLS)
    ↓ ┌────────────────────────────────────────┐
    ├─→ Frontend (Port 3000)
    ├─→ Backend API (Port 3001)
    ├─→ Public Viewer (Port 3004)
    └─→ Marketing Site (Port 8080)
    
All containers ← PostgreSQL (Port 5432)
```

---

## Prerequisites

### OCI Instance Setup

**Instance Details**:
- **IP Address**: 79.72.16.68 (example, use your actual IP)
- **OS**: Ubuntu 24.04.4 LTS
- **CPU**: 2 cores (minimum)
- **RAM**: 4GB (minimum)
- **Storage**: 50GB (minimum)
- **Firewall Rules**: 
  - Port 80 (HTTP)
  - Port 443 (HTTPS)
  - Port 22 (SSH)

### SSH Access

**Connect to instance**:
```bash
ssh -i /path/to/ssh-key.key ubuntu@79.72.16.68
```

Or add to SSH config (`~/.ssh/config`):
```
Host oci-prod
  HostName 79.72.16.68
  User ubuntu
  IdentityFile ~/.ssh/ssh-key-prod.key
  StrictHostKeyChecking no
```

Then connect: `ssh oci-prod`

### DNS Configuration

**Domain**: claros-dpp.online

**DNS A Record**:
```
Type: A
Name: claros-dpp.online
Value: 79.72.16.68
TTL: 3600
```

Or wildcard:
```
Type: A
Name: *.claros-dpp.online
Value: 79.72.16.68
TTL: 3600
```

---

## Installation Steps

### 1. SSH into OCI Instance

```bash
ssh -i /path/to/ssh-key.key ubuntu@79.72.16.68
```

### 2. Update System

```bash
sudo apt update
sudo apt upgrade -y
```

### 3. Install Docker

```bash
# Install dependencies
sudo apt install -y \
  apt-transport-https \
  ca-certificates \
  curl \
  gnupg \
  lsb-release

# Add Docker GPG key
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# Add Docker repository
echo \
  "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Verify installation
docker --version
docker-compose --version
```

### 4. Configure Docker Permissions

```bash
# Add ubuntu user to docker group
sudo usermod -aG docker ubuntu

# Apply group membership without logout
newgrp docker
```

### 5. Install Caddy

```bash
# Install Caddy
sudo apt install -y caddy

# Stop Caddy (will manage via systemd)
sudo systemctl stop caddy
sudo systemctl disable caddy
```

### 6. Clone Repository

```bash
# Create app directory
mkdir -p /opt/apps
cd /opt/apps

# Clone repository
git clone https://github.com/yashd810/Digital-Product-Passport.git
cd Digital-Product-Passport

# Verify structure
ls -la
```

### 7. Configure Environment

```bash
# Copy environment template
cp .env.example .env.prod

# Edit with production values
nano .env.prod
```

**Production .env.prod**:
```bash
# Database
DB_HOST=postgres
DB_PORT=5432
DB_NAME=dpp_db
DB_USER=dpp_user
DB_PASSWORD=your_strong_password_here

# API
API_PORT=3001
API_BASE_URL=https://api.claros-dpp.online
NODE_ENV=production
LOG_LEVEL=info

# Frontend
VITE_API_URL=https://api.claros-dpp.online
VITE_PUBLIC_VIEWER_URL=https://viewer.claros-dpp.online

# JWT
JWT_SECRET=your-secure-random-secret-key-here-min-32-chars
JWT_EXPIRY=24h

# Email (optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password

# Backups
BACKUP_RETENTION_DAYS=30
BACKUP_SCHEDULE=0 2 * * *  # Daily at 2 AM
```

### 8. Create Docker Compose Override

Create `docker-compose.prod.yml`:
```yaml
version: '3.8'

services:
  postgres:
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data_prod:/var/lib/postgresql/data
    restart: unless-stopped

  backend-api:
    env_file: .env.prod
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3001/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  frontend-app:
    restart: unless-stopped

  public-passport-viewer:
    restart: unless-stopped

  marketing-site:
    restart: unless-stopped

volumes:
  postgres_data_prod:
    driver: local
```

### 9. Configure Caddy

Edit `/etc/caddy/Caddyfile`:

```
# Global settings
{
  email admin@claros-dpp.online
  acme_dns manual
}

# Main domain - frontend
claros-dpp.online {
  reverse_proxy localhost:3000
  encode gzip
  log {
    output file /var/log/caddy/access.log {
      roll_size 10MB
      roll_keep 10
    }
  }
}

# API subdomain
api.claros-dpp.online {
  reverse_proxy localhost:3001
  encode gzip
}

# Public viewer subdomain
viewer.claros-dpp.online {
  reverse_proxy localhost:3004
  encode gzip
}

# Marketing site subdomain (optional)
www.claros-dpp.online {
  reverse_proxy localhost:8080
  encode gzip
}
```

### 10. Start Services

```bash
cd /opt/apps/Digital-Product-Passport

# Start with production compose file
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f
```

### 11. Enable Caddy

```bash
# Start Caddy
sudo systemctl start caddy

# Enable auto-start
sudo systemctl enable caddy

# Check status
sudo systemctl status caddy

# View Caddy logs
sudo journalctl -u caddy -f
```

### 12. Verify Deployment

```bash
# Check all services running
docker-compose ps

# Test frontend
curl -I https://claros-dpp.online

# Test API
curl -I https://api.claros-dpp.online/api/health

# Test SSL certificate
curl -v https://claros-dpp.online 2>&1 | grep -i "certificate\|issuer"
```

---

## Post-Deployment Configuration

### Database Backup

**Setup automated backups**:

```bash
# Create backup directory
sudo mkdir -p /backups/dpp
sudo chown ubuntu:ubuntu /backups/dpp

# Create backup script
cat > /opt/backup-dpp.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/backups/dpp"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/dpp_db_$TIMESTAMP.sql"

docker-compose -f /opt/apps/Digital-Product-Passport/docker-compose.yml \
  exec -T postgres pg_dump -U dpp_user dpp_db > "$BACKUP_FILE"

# Compress
gzip "$BACKUP_FILE"

# Keep only last 30 days
find "$BACKUP_DIR" -name "*.sql.gz" -mtime +30 -delete

echo "Backup completed: $BACKUP_FILE.gz"
EOF

chmod +x /opt/backup-dpp.sh

# Add to crontab (daily at 2 AM)
(crontab -l 2>/dev/null; echo "0 2 * * * /opt/backup-dpp.sh") | crontab -
```

**Manual backup**:
```bash
docker-compose exec postgres pg_dump -U dpp_user dpp_db > backup_$(date +%Y%m%d).sql
```

### Log Rotation

```bash
# Create logrotate config
sudo tee /etc/logrotate.d/caddy > /dev/null << EOF
/var/log/caddy/*.log {
  daily
  rotate 14
  compress
  delaycompress
  notifempty
  create 0640 www-data www-data
  sharedscripts
  postrotate
    systemctl reload caddy > /dev/null 2>&1 || true
  endscript
}
EOF
```

### Monitoring

**Check disk space**:
```bash
df -h
```

**Monitor services**:
```bash
# Check running containers
docker ps

# View resource usage
docker stats

# Check system status
top
```

**Setup health checks**:

```bash
# Create monitoring script
cat > /opt/monitor-dpp.sh << 'EOF'
#!/bin/bash

echo "=== DPP Monitoring $(date) ==="

# Check services
echo "Services Status:"
docker-compose -f /opt/apps/Digital-Product-Passport/docker-compose.yml ps

# Check disk
echo "Disk Usage:"
df -h /

# Check API
echo "API Health:"
curl -s https://api.claros-dpp.online/api/health | jq .

# Check certificate expiry
echo "Certificate Expiry:"
echo | openssl s_client -servername claros-dpp.online -connect 79.72.16.68:443 2>/dev/null | openssl x509 -noout -dates
EOF

chmod +x /opt/monitor-dpp.sh

# Run periodically
(crontab -l 2>/dev/null; echo "0 */6 * * * /opt/monitor-dpp.sh >> /var/log/dpp-monitor.log") | crontab -
```

---

## Deployment Commands

### Deploy Updates

```bash
cd /opt/apps/Digital-Product-Passport

# Pull latest code
git pull origin main

# Rebuild images
docker-compose build --no-cache

# Restart services
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Verify deployment
docker-compose ps
```

### Scale Services

```bash
# Run multiple backend instances (if needed)
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d --scale backend-api=2

# View running instances
docker-compose ps
```

### Database Migration

```bash
# Run migrations
docker-compose exec backend-api npm run migrate

# Check migration status
docker-compose exec backend-api npm run migrate:status
```

### Rollback

```bash
# Get previous commit
git log --oneline

# Checkout previous version
git checkout <commit-hash>

# Rebuild and restart
docker-compose build --no-cache
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

---

## Troubleshooting

### Services Won't Start

```bash
# Check logs
docker-compose logs -f

# Check specific service
docker-compose logs backend-api

# Rebuild images
docker-compose build --no-cache

# Try again
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### Database Connection Error

```bash
# Check database is running
docker-compose ps postgres

# Check database logs
docker-compose logs postgres

# Verify database credentials
docker-compose exec postgres psql -U dpp_user -d dpp_db -c "SELECT 1;"
```

### SSL Certificate Issues

```bash
# Check Caddy status
sudo systemctl status caddy

# View Caddy logs
sudo journalctl -u caddy -f

# Check certificate
curl -v https://claros-dpp.online 2>&1 | grep -i certificate

# Restart Caddy
sudo systemctl restart caddy
```

### High CPU/Memory Usage

```bash
# Check resource usage
docker stats

# View detailed logs
docker-compose logs backend-api

# Optimize database
docker-compose exec postgres vacuumdb -U dpp_user -d dpp_db -f
```

### Connection Refused

```bash
# Check if ports are listening
sudo netstat -tuln | grep LISTEN

# Check firewall
sudo ufw status

# Open required ports
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

---

## Maintenance

### Regular Tasks

**Weekly**:
- Check disk space: `df -h`
- Review error logs: `docker-compose logs --tail=100`
- Verify backups completed

**Monthly**:
- Update Docker images: `docker-compose pull`
- Review security updates: `sudo apt update && apt list --upgradable`
- Database optimization: `VACUUM ANALYZE;`

**Quarterly**:
- Security audit
- Performance analysis
- Disaster recovery test

### Update Process

```bash
# 1. Backup database
/opt/backup-dpp.sh

# 2. Pull updates
cd /opt/apps/Digital-Product-Passport
git pull origin main

# 3. Build new images
docker-compose build --no-cache

# 4. Test in staging (if available)
# Manual testing steps

# 5. Deploy to production
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# 6. Verify
docker-compose ps
curl https://claros-dpp.online

# 7. Monitor logs
docker-compose logs -f
```

---

## Security Checklist

- [ ] SSH key configured (not password login)
- [ ] Firewall rules configured (UFW or OCI security lists)
- [ ] SSL/TLS certificates valid
- [ ] Database password is strong (20+ chars)
- [ ] JWT secret is strong and unique
- [ ] Regular backups enabled and tested
- [ ] Log monitoring setup
- [ ] Automatic security updates enabled
- [ ] Caddy logs monitored
- [ ] Database exposed only to internal network

```bash
# Enable automatic security updates
sudo apt install unattended-upgrades
sudo systemctl enable unattended-upgrades
```

---

## Disaster Recovery

### Backup Restoration

```bash
# List backups
ls -lah /backups/dpp/

# Restore from backup
docker-compose exec -T postgres psql -U dpp_user -d dpp_db < /backups/dpp/dpp_db_TIMESTAMP.sql
```

### Server Restoration

If entire server fails:

1. Launch new OCI instance (Ubuntu 24.04 LTS)
2. Run installation steps 2-11 above
3. Restore database from backup
4. Verify all services running

---

## Performance Optimization

### Database Optimization

```bash
# Analyze and vacuum
docker-compose exec postgres psql -U dpp_user -d dpp_db << EOF
ANALYZE;
VACUUM ANALYZE;
REINDEX DATABASE dpp_db;
EOF

# Check slow queries
docker-compose exec postgres psql -U dpp_user -d dpp_db << EOF
SELECT query, mean_time, calls 
FROM pg_stat_statements 
ORDER BY mean_time DESC 
LIMIT 10;
EOF
```

### Caddy Caching

Add to Caddyfile for better performance:

```
claros-dpp.online {
  reverse_proxy localhost:3000
  encode gzip
  cache {
    default_max_age 1h
    match_header Cache-Control public
  }
}
```

---

## Cost Optimization

1. **Right-size instance** - Start with 2 cores, scale if needed
2. **Use auto-scaling** - If using Kubernetes
3. **Compress logs** - Automatic with logrotate
4. **Optimize database** - Regular VACUUM and ANALYZE
5. **Monitor usage** - Track actual resource needs

---

## Next Steps

1. **Verify Deployment**: 
   ```bash
   curl https://claros-dpp.online
   ```

2. **Create Test Account**: Go to https://claros-dpp.online/signup

3. **Monitor Logs**: 
   ```bash
   docker-compose logs -f
   ```

4. **Setup Backups**: Run backup scripts above

5. **Enable Monitoring**: Setup system monitoring and alerts

---

## Support

For issues or questions:
- Check logs: `docker-compose logs`
- Review [TROUBLESHOOTING.md](../TROUBLESHOOTING.md)
- Check GitHub issues
- Review [ARCHITECTURE.md](../ARCHITECTURE.md)

