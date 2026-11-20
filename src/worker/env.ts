export interface Env {
  DIRECTORY_DO: DurableObjectNamespace;
  HOST_SCHEDULER_DO: DurableObjectNamespace;
  SEND_EMAIL?: SendEmail;
  ASSETS?: Fetcher;
  APP_NAME?: string;
  ALLOW_SIGNUPS?: string;
  APP_URL?: string;
  EMAIL_FROM?: string;
  EMAIL_FROM_NAME?: string;
  DAILY_API_KEY?: string;
}
