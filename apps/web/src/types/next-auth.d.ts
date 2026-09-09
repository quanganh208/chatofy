import 'next-auth';
import 'next-auth/jwt';

/**
 * The Nest access token, carried through the session.
 *
 * Declared here rather than cast at each read: `session.accessToken` is what the
 * api client and both WebSocket transports consume, and an untyped read would
 * make a rename in `auth.ts` a runtime failure at connect time instead of a
 * build error.
 */
declare module 'next-auth' {
  interface Session {
    accessToken?: string;
  }
  interface User {
    accessToken?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    accessToken?: string;
  }
}
