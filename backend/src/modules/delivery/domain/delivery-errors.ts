export type DeliveryErrorCategory =
  | 'PDF_UNAVAILABLE'
  | 'MAIL_NOT_CONFIGURED'
  | 'MAIL_AUTHENTICATION'
  | 'MAIL_REJECTED'
  | 'MAIL_PROVIDER'

export class DeliveryError extends Error {
  constructor(
    readonly category: DeliveryErrorCategory,
    message: string,
    readonly providerStatus: number | null = null,
  ) {
    super(message)
    this.name = 'DeliveryError'
  }
}
