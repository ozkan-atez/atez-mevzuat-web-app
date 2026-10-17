#!/bin/sh
# Docker yerel profili: oluşturulan kimlik ayarlarını (auth.env) yükler; issuer localhost'u gösterdiği
# için container içinden Keycloak'a ulaşmak üzere loopback köprüsünü başlatır, sonra komutu çalıştırır.
set -e
if [ -f /auth/auth.env ]; then
  set -a
  . /auth/auth.env
  set +a
fi
if [ -n "$OIDC_LOOPBACK_TARGET" ] && [ -n "$OIDC_ISSUER_URL" ]; then
  node scripts/docker/loopback-proxy.mjs &
fi
exec "$@"
