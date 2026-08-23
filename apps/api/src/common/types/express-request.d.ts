// Global Express Request augmentation — single canonical place for request-scoped
// fields added by middleware. Shared by request-id middleware, TransformInterceptor,
// and AllExceptionsFilter so the `requestId` field is typed consistently.

declare global {
  namespace Express {
    interface Request {
      /** Correlation id set by request-id middleware (per-request, never shared). */
      requestId?: string;
      /**
       * Identity proved by JwtAuthGuard. Present only on a request the guard
       * let through with a verified token — absent on a @Public() route, which
       * is why every read of it must handle undefined.
       */
      auth?: { userId: string };
    }
  }
}

export {};
