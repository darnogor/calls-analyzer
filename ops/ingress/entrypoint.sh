#!/bin/sh
set -eu
mkdir -p /etc/nginx/certs
if [ ! -f /etc/nginx/certs/tls.crt ]; then
  openssl req -x509 -nodes -newkey rsa:2048 \
    -keyout /etc/nginx/certs/tls.key \
    -out /etc/nginx/certs/tls.crt \
    -days 3650 \
    -subj "/CN=localhost"
fi
exec nginx -g 'daemon off;'
