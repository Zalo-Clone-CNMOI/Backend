#!/bin/bash

# ================================================
# EC2 Server Setup Script for Zalo Clone Backend
# ================================================
# For Amazon Linux 2023 (AL2023) or Amazon Linux 2 (AL2)
# Usage: chmod +x setup-server.sh && sudo ./setup-server.sh
# ================================================

set -e

echo "================================================"
echo "🚀 Zalo Clone - EC2 Server Setup Script"
echo "   (Amazon Linux Edition)"
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

# Detect Amazon Linux version
detect_al_version() {
    if grep -q "Amazon Linux 2023" /etc/os-release 2>/dev/null; then
        echo "al2023"
    elif grep -q "Amazon Linux 2" /etc/os-release 2>/dev/null; then
        echo "al2"
    else
        echo "unknown"
    fi
}

AL_VERSION=$(detect_al_version)
log_info "Detected Amazon Linux version: $AL_VERSION"

if [ "$AL_VERSION" = "unknown" ]; then
    log_error "This script is designed for Amazon Linux 2 or Amazon Linux 2023"
    exit 1
fi

# Set package manager
if [ "$AL_VERSION" = "al2023" ]; then
    PKG_MANAGER="dnf"
else
    PKG_MANAGER="yum"
fi

# ================================
# 1. System Update
# ================================
log_info "Updating system packages..."
$PKG_MANAGER update -y

# ================================
# 2. Install Essential Packages
# ================================
log_info "Installing essential packages..."
$PKG_MANAGER install -y \
    wget \
    git \
    htop \
    vim \
    unzip \
    jq \
    tar \
    gzip \
    nc

# ================================
# 3. Install Docker
# ================================
log_info "Installing Docker..."

if [ "$AL_VERSION" = "al2023" ]; then
    # Amazon Linux 2023
    $PKG_MANAGER install -y docker
else
    # Amazon Linux 2
    amazon-linux-extras install docker -y
fi

# Start and enable Docker
systemctl start docker
systemctl enable docker

# Add ec2-user to docker group
CURRENT_USER=${SUDO_USER:-ec2-user}
usermod -aG docker $CURRENT_USER

log_info "Docker installed successfully!"
docker --version

# ================================
# 4. Install Docker Compose
# ================================
log_info "Installing Docker Compose..."

# Install Docker Compose plugin
mkdir -p /usr/local/lib/docker/cli-plugins
curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-$(uname -m)" -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

# Also create symlink for standalone use
ln -sf /usr/local/lib/docker/cli-plugins/docker-compose /usr/local/bin/docker-compose

log_info "Docker Compose installed!"
docker compose version

# ================================
# 5. Configure Firewall (iptables/firewalld)
# ================================
log_info "Configuring firewall..."

if [ "$AL_VERSION" = "al2023" ]; then
    # Amazon Linux 2023 uses firewalld
    $PKG_MANAGER install -y firewalld
    systemctl start firewalld
    systemctl enable firewalld

    # Allow SSH
    firewall-cmd --permanent --add-service=ssh
    # Allow HTTP and HTTPS
    firewall-cmd --permanent --add-service=http
    firewall-cmd --permanent --add-service=https
    # Allow application port
    firewall-cmd --permanent --add-port=5000/tcp

    # Reload firewall
    firewall-cmd --reload
    
    log_info "Firewall configured!"
    firewall-cmd --list-all
else
    # Amazon Linux 2 uses iptables
    $PKG_MANAGER install -y iptables-services
    systemctl start iptables
    systemctl enable iptables

    # Flush existing rules
    iptables -F

    # Default policies
    iptables -P INPUT DROP
    iptables -P FORWARD DROP
    iptables -P OUTPUT ACCEPT

    # Allow loopback
    iptables -A INPUT -i lo -j ACCEPT

    # Allow established connections
    iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

    # Allow SSH
    iptables -A INPUT -p tcp --dport 22 -j ACCEPT
    # Allow HTTP
    iptables -A INPUT -p tcp --dport 80 -j ACCEPT
    # Allow HTTPS
    iptables -A INPUT -p tcp --dport 443 -j ACCEPT
    # Allow BFF Service
    iptables -A INPUT -p tcp --dport 5000 -j ACCEPT

    # Save rules
    service iptables save

    log_info "Firewall configured!"
    iptables -L -n
fi

# ================================
# 6. Install and Configure Fail2Ban
# ================================
log_info "Installing Fail2Ban..."

if [ "$AL_VERSION" = "al2023" ]; then
    $PKG_MANAGER install -y fail2ban
else
    # For AL2, need to enable EPEL first
    amazon-linux-extras install epel -y
    $PKG_MANAGER install -y fail2ban
fi

cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = ssh
logpath = /var/log/secure
maxretry = 3
bantime = 86400
EOF

systemctl start fail2ban
systemctl enable fail2ban

log_info "Fail2Ban configured!"

# ================================
# 7. Create Application Directory
# ================================
log_info "Creating application directory..."

APP_DIR="/home/$CURRENT_USER/zalo-clone"
mkdir -p $APP_DIR
chown -R $CURRENT_USER:$CURRENT_USER $APP_DIR

# ================================
# 8. Setup Docker Logging
# ================================
log_info "Configuring Docker logging..."

mkdir -p /etc/docker
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
# 9. Setup Swap (for small instances)
# ================================
log_info "Setting up swap space..."

if [ ! -f /swapfile ]; then
    dd if=/dev/zero of=/swapfile bs=128M count=16  # 2GB swap
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile swap swap defaults 0 0' >> /etc/fstab
    log_info "Swap configured: 2GB"
else
    log_warn "Swap already exists"
fi

# ================================
# 10. Create Helper Scripts
# ================================
log_info "Creating deployment scripts..."

# Deploy script
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
# 11. Summary
# ================================
echo ""
echo "================================================"
echo "✅ Server Setup Complete!"
echo "================================================"
echo ""
echo "📋 System Info:"
echo "  - OS: Amazon Linux ($AL_VERSION)"
echo "  - Package Manager: $PKG_MANAGER"
echo "  - Docker: $(docker --version)"
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
if [ "$AL_VERSION" = "al2023" ]; then
    echo "  - Firewalld enabled (ports: 22, 80, 443, 5000)"
else
    echo "  - iptables configured (ports: 22, 80, 443, 5000)"
fi
echo "  - Fail2Ban configured for SSH protection"
echo ""
echo "⚠️  IMPORTANT: Log out and log back in for docker group to take effect!"
echo "================================================"
