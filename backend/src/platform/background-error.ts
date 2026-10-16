/** A durable failure that an unchanged automatic retry cannot resolve. */
export class BackgroundTaskError extends Error {
  constructor(message:string,readonly code:string,readonly retryable:boolean,readonly details:Record<string,unknown>={}){super(message);this.name='BackgroundTaskError'}
}
