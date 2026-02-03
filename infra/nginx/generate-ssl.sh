#!/bin/bash

# ================================================
# SSL Certificate Generator for Nginx
# ================================================
# This script generates self-signed SSL certificates for development/testing.
# For production, use proper certificates from Let's Encrypt or your CA.

SSL_DIR="./ssl"
CERT_FILE="$SSL_DIR/cert.pem"
KEY_FILE="$SSL_DIR/key.pem"

# Create SSL directory if it doesn't exist
mkdir -p "$SSL_DIR"

echo "🔐 Generating self-signed SSL certificate..."

# Generate self-signed certificate (valid for 365 days)
openssl req -x509 \
    -nodes \
    -days 365 \
    -newkey rsa:2048 \
    -keyout "$KEY_FILE" \
    -out "$CERT_FILE" \
    -subj "/C=VN/ST=HCM/L=HoChiMinh/O=ZaloClone/OU=Development/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,DNS:*.localhost,IP:127.0.0.1"

if [ $? -eq 0 ]; then
    echo "✅ SSL certificate generated successfully!"
    echo "📁 Certificate: $CERT_FILE"
    echo "🔑 Private key: $KEY_FILE"
    echo ""
    echo "⚠️  WARNING: This is a SELF-SIGNED certificate for development only."
    echo "    For production, use proper certificates from Let's Encrypt or your CA."
else
    echo "❌ Failed to generate SSL certificate"
    exit 1
fi
