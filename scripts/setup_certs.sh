#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
CERTS_DIR="$ROOT_DIR/certs"

echo "================================================================================"
echo "🔐 LiteRouter Local TLS Certificate Setup (mkcert)"
echo "================================================================================"

if ! command -v mkcert &> /dev/null; then
  echo "💥 Error: 'mkcert' is not installed."
  echo "Please install mkcert first:"
  echo "  • macOS: brew install mkcert"
  echo "  • Linux: sudo apt install libnss3-tools && curl -JLO 'https://dl.filippo.io/mkcert/latest?for=linux/amd64' ..."
  exit 1
fi

mkdir -p "$CERTS_DIR"
chmod 700 "$CERTS_DIR"

echo "Installing local Root CA..."
mkcert -install

echo "Generating certificates for localhost, 127.0.0.1, ::1..."
mkcert -cert-file "$CERTS_DIR/localhost.pem" -key-file "$CERTS_DIR/localhost-key.pem" localhost 127.0.0.1 ::1

chmod 600 "$CERTS_DIR/localhost.pem"
chmod 600 "$CERTS_DIR/localhost-key.pem"

echo "================================================================================"
echo "🟢 Trusted TLS Certificates generated successfully in $CERTS_DIR"
echo "   • Certificate: $CERTS_DIR/localhost.pem (mode 0600)"
echo "   • Private Key: $CERTS_DIR/localhost-key.pem (mode 0600)"
echo "LiteRouter will now automatically enable HTTP/2 (h2 ALPN) on boot."
echo "================================================================================"
