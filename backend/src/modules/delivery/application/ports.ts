export interface PdfRenderer {
  renderHtml(html: string, options?: { fileName?: string }): Promise<Buffer>
}

export interface MailAttachment {
  fileName: string
  mediaType: string
  content: Buffer
}

export interface MailMessage {
  to: string[]
  subject: string
  html: string
  attachments: MailAttachment[]
}

export interface MailSendResult {
  status: 'SENT' | 'SIMULATED'
  providerMessageId: string | null
}

export interface MailSender {
  /** False when Graph credentials are absent; the caller records a simulated dispatch instead. */
  readonly configured: boolean
  send(message: MailMessage): Promise<MailSendResult>
}
