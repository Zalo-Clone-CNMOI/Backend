#!/bin/bash

# ================================================
# EC2 Server Setup Script for Zalo Clone Backend
# ================================================
# Run this script on a fresh Ubuntu 22.04/24.04 EC2 instance
# Usage: chmod +x setup-server.sh && sudo ./setup-server.sh
# ================================================

set -e

echo "================================================"
echo "🚀 Zalo Clone - EC2 Server Setup Script"
echo "================================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# ================================
# 1. System Update
# ================================
log_info "Updating system packages..."
apt-get update -y
apt-get upgrade -y

# ================================
# 2. Install Essential Packages
# ================================
log_info "Installing essential packages..."
apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release \
    software-properties-common \
    git \
    htop \
    vim \
    wget \
    unzip \
    jq \
    fail2ban \
    ufw

# ================================
# 3. Install Docker
# ================================
log_info "Installing Docker..."

# Remove old versions
apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

# Add Docker's official GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

# Set up repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Start and enable Docker
systemctl start docker
systemctl enable docker

# Add current user to docker group
CURRENT_USER=${SUDO_USER:-$USER}
usermod -aG docker $CURRENT_USER

log_info "Docker installed successfully!"
docker --version
docker compose version

# ================================
# 4. Configure Firewall (UFW)
# ================================
log_info "Configuring firewall..."

# Reset UFW to default
ufw --force reset

# Default policies
ufw default deny incoming
ufw default allow outgoing

# Allow SSH
ufw allow 22/tcp

# Allow HTTP and HTTPS
ufw allow 80/tcp
ufw allow 443/tcp

# Allow application ports (adjust as needed)
ufw allow 5000/tcp  # BFF Service

# Enable firewall
ufw --force enable

log_info "Firewall configured!"
ufw status

# ================================
# 5. Configure Fail2Ban
# ================================
log_info "Configuring Fail2Ban..."

cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = ssh
logpath = %(sshd_log)s
maxretry = 3
bantime = 86400
EOF

systemctl restart fail2ban
systemctl enable fail2ban

# ================================
# 6. Create Application Directory
# ================================
log_info "Creating application directory..."

APP_DIR="/home/$CURRENT_USER/zalo-clone"
mkdir -p $APP_DIR
chown -R $CURRENT_USER:$CURRENT_USER $APP_DIR

# ================================
# 7. Setup Docker Logging
# ================================
log_info "Configuring Docker logging..."

cat > /etc/docker/daemon.json << 'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF

systemctl restart docker

# ================================
# 8. Setup Swap (for small instances)
# ================================
log_info "Setting up swap space..."

if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    log_info "Swap configured: 2GB"
else
    log_warn "Swap already exists"
fi

# ================================
# 9. Create Deploy User (optional)
# ================================
log_info "Creating deployment scripts..."

# Create helper scripts
cat > $APP_DIR/deploy.sh << 'EOF'
#!/bin/bash
set -e

cd ~/zalo-clone

echo "🔄 Pulling latest images..."
docker compose -f docker-compose.prod.yml pull

echo "🚀 Restarting services..."
docker compose -f docker-compose.prod.yml up -d

echo "🧹 Cleaning up old images..."
docker image prune -f

echo "📊 Current status:"
docker compose -f docker-compose.prod.yml ps

echo "✅ Deployment complete!"
EOF
chmod +x $APP_DIR/deploy.sh

# Logs script
cat > $APP_DIR/logs.sh << 'EOF'
#!/bin/bash
SERVICE=${1:-"all"}

if [ "$SERVICE" = "all" ]; then
    docker compose -f ~/zalo-clone/docker-compose.prod.yml logs -f --tail=100
else
    docker compose -f ~/zalo-clone/docker-compose.prod.yml logs -f --tail=100 $SERVICE
fi
EOF
chmod +x $APP_DIR/logs.sh

# Status script
cat > $APP_DIR/status.sh << 'EOF'
#!/bin/bash
echo "📊 Container Status:"
docker compose -f ~/zalo-clone/docker-compose.prod.yml ps

echo ""
echo "💾 Disk Usage:"
df -h | grep -E "Filesystem|/$"

echo ""
echo "🧠 Memory Usage:"
free -h

echo ""
echo "🐳 Docker Stats:"
docker stats --no-stream
EOF
chmod +x $APP_DIR/status.sh

# Restart script
cat > $APP_DIR/restart.sh << 'EOF'
#!/bin/bash
SERVICE=${1:-""}

if [ -z "$SERVICE" ]; then
    echo "🔄 Restarting all services..."
    docker compose -f ~/zalo-clone/docker-compose.prod.yml restart
else
    echo "🔄 Restarting $SERVICE..."
    docker compose -f ~/zalo-clone/docker-compose.prod.yml restart $SERVICE
fi
EOF
chmod +x $APP_DIR/restart.sh

chown -R $CURRENT_USER:$CURRENT_USER $APP_DIR

# ================================
# 10. Summary
# ================================
echo ""
echo "================================================"
echo "✅ Server Setup Complete!"
echo "================================================"
echo ""
echo "📋 Next Steps:"
echo "1. Upload docker-compose.prod.yml to ~/zalo-clone/"
echo "2. Create .env.prod file with production values"
echo "3. Run: cd ~/zalo-clone && docker compose -f docker-compose.prod.yml up -d"
echo ""
echo "📁 Helper Scripts:"
echo "  ~/zalo-clone/deploy.sh   - Deploy/update services"
echo "  ~/zalo-clone/logs.sh     - View service logs"
echo "  ~/zalo-clone/status.sh   - Check system status"
echo "  ~/zalo-clone/restart.sh  - Restart services"
echo ""
echo "🔐 Security:"
echo "  - UFW firewall enabled (ports: 22, 80, 443, 5000)"
echo "  - Fail2Ban configured for SSH protection"
echo ""
echo "⚠️  IMPORTANT: Log out and log back in for docker group to take effect!"
echo "================================================"
