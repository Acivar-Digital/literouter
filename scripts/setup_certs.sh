#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERTS_DIR="${ROOT_DIR}/certs"

mkdir -p "${CERTS_DIR}"

# Default domains and IPs (including local loopback and ZeroTier IP)
SAN_DOMAINS="${SAN_DOMAINS:-localhost 127.0.0.1 10.32.34.243 ::1}"

if command -v mkcert &>/dev/null; then
  echo "Generating trusted localhost certificates via mkcert..."
  # shellcheck disable=SC2086
  mkcert -cert-file "${CERTS_DIR}/localhost.pem" -key-file "${CERTS_DIR}/localhost-key.pem" $SAN_DOMAINS
  chmod 600 "${CERTS_DIR}/localhost.pem" "${CERTS_DIR}/localhost-key.pem"
  echo "✅ Certificates ready in ${CERTS_DIR}"
elif command -v openssl &>/dev/null; then
  echo "mkcert not found. Falling back to openssl certificates with SANs ($SAN_DOMAINS)..."
  SAN_CONFIG="subjectAltName=DNS:localhost,IP:127.0.0.1,IP:10.32.34.243,IP:::1"
  openssl req -x509 -newkey rsa:2048 -nodes -sha256 -subj '/CN=localhost' \
    -addext "$SAN_CONFIG" \
    -keyout "${CERTS_DIR}/localhost-key.pem" -out "${CERTS_DIR}/localhost.pem" -days 365
  chmod 600 "${CERTS_DIR}/localhost.pem" "${CERTS_DIR}/localhost-key.pem"
  echo "✅ Certificates ready in ${CERTS_DIR}"
else
  echo "❌ Neither mkcert nor openssl found."
  exit 1
fi
