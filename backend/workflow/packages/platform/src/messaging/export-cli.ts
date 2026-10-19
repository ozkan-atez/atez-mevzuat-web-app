import { topologyDefinitions } from './topology'

/** Altyapı ekibine verilecek RabbitMQ definitions JSON'u (kuyruk açma yetkisi yoksa). */
const vhost = process.argv[2] ?? 'atez-mevzuat'
process.stdout.write(JSON.stringify(topologyDefinitions(vhost), null, 2) + '\n')
