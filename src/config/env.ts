import { z } from 'zod';

export const envSchema = z.object({
  // Bindings provided by Cloudflare
  DB: z.custom<D1Database>((val) => val !== undefined && val !== null, {
    message: 'DB (D1Database) binding is required',
  }),
  GRANT_QUEUE: z.custom<Queue>((val) => val !== undefined && val !== null, {
    message: 'GRANT_QUEUE (Queue) binding is required',
  }),
  ASSETS: z.custom<Fetcher>((val) => val !== undefined && val !== null, {
    message: 'ASSETS (Fetcher) binding is required',
  }).optional(),

  // Secrets & Environment variables
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1, 'RAZORPAY_WEBHOOK_SECRET is required'),
  RAZORPAY_WEBHOOK_SECRET_PREVIOUS: z.string().optional(),

  // Google Service Account
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email().optional(),
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: z.string().optional(),

  // Google OAuth (alternative to service account)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REFRESH_TOKEN: z.string().optional(),

  // Admin Auth
  ADMIN_USERNAME: z.string().default('admin'),
  ADMIN_PASSWORD: z.string().min(8, 'ADMIN_PASSWORD must be at least 8 characters').optional(),
  ADMIN_SESSION_SECRET: z.string().min(32, 'ADMIN_SESSION_SECRET must be at least 32 characters'),
});

export type Env = z.infer<typeof envSchema>;

export interface WorkerEnv {
  DB: D1Database;
  GRANT_QUEUE: Queue;
  ASSETS?: Fetcher;
  RAZORPAY_WEBHOOK_SECRET: string;
  RAZORPAY_WEBHOOK_SECRET_PREVIOUS?: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET: string;
}
