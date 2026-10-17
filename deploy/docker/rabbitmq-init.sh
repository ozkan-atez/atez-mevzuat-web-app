#!/bin/sh
# v2 kendi vhost'unu (atez-mevzuat) kullanır; eski uygulama "/" vhost'unda kalır. İdempotent.
set -e
api="http://rabbitmq:15672/api"
auth="$RABBITMQ_USER:$RABBITMQ_PASSWORD"
curl -fsS -u "$auth" -X PUT "$api/vhosts/atez-mevzuat" -H 'content-type: application/json' -d '{}'
curl -fsS -u "$auth" -X PUT "$api/permissions/atez-mevzuat/$RABBITMQ_USER" -H 'content-type: application/json' -d '{"configure":".*","write":".*","read":".*"}'
echo "RabbitMQ vhost atez-mevzuat hazır."
