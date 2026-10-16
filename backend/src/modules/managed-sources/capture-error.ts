export class SourceSizeLimitError extends Error {
  readonly code='DOCUMENT_TOO_LARGE'
  constructor(readonly url:string,readonly limitBytes:number,readonly observedBytes:number){super(`Belge boyut sınırını aşıyor: ${observedBytes} > ${limitBytes} bayt. ${url}`);this.name='SourceSizeLimitError'}
}
export function captureFailure(error:unknown,url:string,limitBytes:number){
 const message=error instanceof Error?error.message:'Dosya indirilemedi'
 const oversized=error instanceof SourceSizeLimitError||/boyut sınırı|boyutu.*sınır|boyut.*aşı/i.test(message)
 return {code:oversized?'DOCUMENT_TOO_LARGE':/AUTH_REQUIRED|SUBSCRIPTION_REQUIRED|USER_ACTION_REQUIRED/.test(message)?'ACCESS_REQUIRED':'DOWNLOAD_FAILED',url,
  retryable:!oversized&&!/AUTH_REQUIRED|SUBSCRIPTION_REQUIRED|USER_ACTION_REQUIRED/.test(message),manualActionRequired:oversized||/AUTH_REQUIRED|SUBSCRIPTION_REQUIRED|USER_ACTION_REQUIRED/.test(message),
  limitBytes:oversized?limitBytes:null,observedBytes:error instanceof SourceSizeLimitError?error.observedBytes:null,message}
}
