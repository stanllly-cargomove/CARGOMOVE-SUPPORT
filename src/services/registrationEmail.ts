// Backward-compatible entry point for registration-email consumers. Gmail
// authorization, rendering, and sending are all performed by backend routes.
export {
  generateWelcomeEmailPreview,
  sendWelcomeEmail,
} from './email';
export type { EmailPreview } from './email';
