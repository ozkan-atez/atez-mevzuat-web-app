import { ClientSecretCredential } from '@azure/identity'
import { DeliveryError } from '../domain/delivery-errors'
import type { MailMessage, MailSender, MailSendResult } from '../application/ports'

export interface GraphMailOptions {
  tenantId: string | undefined
  clientId: string | undefined
  clientSecret: string | undefined
  senderAddress: string | undefined
  senderName: string
  maxAttachmentBytes: number
}

export interface GraphTransport {
  sendMail(input: { senderAddress: string; accessToken: string; payload: unknown }): Promise<{ requestId: string | null }>
}

/**
 * Sends through Microsoft Graph with application permissions (client credentials),
 * so no interactive sign-in is needed: the app sends as the configured shared mailbox
 * via POST /users/{sender}/sendMail. Requires the Mail.Send application permission
 * with admin consent on the registered app.
 */
export class GraphMailSender implements MailSender {
  private credential: ClientSecretCredential | null = null

  constructor(
    private readonly options: GraphMailOptions,
    private readonly transport: GraphTransport = new HttpGraphTransport(),
  ) {
    const { tenantId, clientId, clientSecret, senderAddress } = options
    if (tenantId && clientId && clientSecret && senderAddress) {
      this.credential = new ClientSecretCredential(tenantId, clientId, clientSecret)
    }
  }

  get configured(): boolean {
    return this.credential !== null
  }

  async send(message: MailMessage): Promise<MailSendResult> {
    const senderAddress = this.options.senderAddress
    if (!this.credential || !senderAddress) {
      throw new DeliveryError('MAIL_NOT_CONFIGURED', 'Microsoft Graph gönderim yapılandırması eksik.')
    }

    const oversized = message.attachments.find((attachment) => attachment.content.byteLength > this.options.maxAttachmentBytes)
    if (oversized) {
      throw new DeliveryError('MAIL_REJECTED', `${oversized.fileName} e-posta eki için fazla büyük.`)
    }

    let accessToken: string
    try {
      const token = await this.credential.getToken('https://graph.microsoft.com/.default')
      if (!token?.token) throw new Error('empty token')
      accessToken = token.token
    } catch {
      throw new DeliveryError('MAIL_AUTHENTICATION', 'Microsoft Graph kimlik doğrulaması başarısız oldu.')
    }

    const payload = {
      message: {
        subject: message.subject,
        body: { contentType: 'HTML', content: message.html },
        from: { emailAddress: { address: senderAddress, name: this.options.senderName } },
        toRecipients: message.to.map((address) => ({ emailAddress: { address } })),
        attachments: message.attachments.map((attachment) => ({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: attachment.fileName,
          contentType: attachment.mediaType,
          contentBytes: attachment.content.toString('base64'),
        })),
      },
      saveToSentItems: true,
    }

    const result = await this.transport.sendMail({ senderAddress, accessToken, payload })
    return { status: 'SENT', providerMessageId: result.requestId }
  }
}

class HttpGraphTransport implements GraphTransport {
  async sendMail(input: { senderAddress: string; accessToken: string; payload: unknown }): Promise<{ requestId: string | null }> {
    const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(input.senderAddress)}/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input.payload),
    })
    if (response.status === 202) return { requestId: response.headers.get('request-id') }
    if (response.status === 401 || response.status === 403) {
      throw new DeliveryError('MAIL_AUTHENTICATION', 'Microsoft Graph gönderim izni reddedildi.', response.status)
    }
    if (response.status === 400 || response.status === 413) {
      throw new DeliveryError('MAIL_REJECTED', 'Microsoft Graph e-postayı kabul etmedi.', response.status)
    }
    throw new DeliveryError('MAIL_PROVIDER', 'Microsoft Graph gönderimi tamamlanamadı.', response.status)
  }
}
