#!/bin/bash

# ================================================
# Manual Deployment Script
# ================================================
# Run this script locally to deploy to EC2
# Usage: ./deploy-manual.sh [service]
# Example: ./deploy-manual.sh bff
# ================================================

set -e

# Configuration (update these values)
EC2_HOST="${EC2_HOST:-your-ec2-ip-or-hostname}"
EC2_USER="${EC2_USER:-ubuntu}"
SSH_KEY="${SSH_KEY:-~/.ssh/your-key.pem}"
REMOTE_DIR="/home/$EC2_USER/zalo-clone"

# Service to deploy (all by default)
SERVICE=${1:-"all"}

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}🚀 Manual Deployment to EC2${NC}"
echo -e "${GREEN}================================================${NC}"

# Check SSH key
if [ ! -f "$SSH_KEY" ]; then
    echo -e "${YELLOW}SSH key not found at $SSH_KEY${NC}"
    echo "Please set SSH_KEY environment variable"
    exit 1
fi

# Copy files
echo "📦 Copying docker-compose files..."
scp -i "$SSH_KEY" docker-compose.prod.yml "$EC2_USER@$EC2_HOST:$REMOTE_DIR/"

# Deploy
echo "🚀 Deploying services..."
ssh -i "$SSH_KEY" "$EC2_USER@$EC2_HOST" << DEPLOY
    set -e
    cd $REMOTE_DIR
    
    # Load environment
    if [ -f .env.prod ]; then
        export \$(cat .env.prod | grep -v '^#' | xargs)
    fi
    
    if [ "$SERVICE" = "all" ]; then
        echo "Pulling and restarting all services..."
        docker compose -f docker-compose.prod.yml pull
        docker compose -f docker-compose.prod.yml up -d
    else
        echo "Pulling and restarting $SERVICE..."
        docker compose -f docker-compose.prod.yml pull $SERVICE
        docker compose -f docker-compose.prod.yml up -d $SERVICE
    fi
    
    # Cleanup
    docker image prune -f
    
    # Status
    echo ""
    echo "📊 Current status:"
    docker compose -f docker-compose.prod.yml ps
DEPLOY

echo ""
echo -e "${GREEN}✅ Deployment complete!${NC}"
