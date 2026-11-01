/**
 * NearU Application and Backend Configuration
 */

export const EAS_CONFIG = {
  projectId: 'f014f0da-32ee-4025-8ee0-a06a8267c3e2',
};

export const BACKEND_CONFIG = {
  /**
   * Cloudflare Worker URL for sending NearU push notifications via Expo Push Service.
   * If not set or during offline development, the app falls back to direct Cloud Firestore
   * event delivery for in-app real-time reception.
   *
   * Once you deploy your Cloudflare Worker via `npx wrangler deploy`, update this value to:
   * e.g. "https://nearu-push-worker.<your-subdomain>.workers.dev"
   */
  WORKER_URL: 'https://nearu-push-worker.nearu-ram-app.workers.dev',
  FIREBASE_PROJECT_ID: 'nearu-962eb',
};
