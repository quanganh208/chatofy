import { GoogleButton } from '@/components/auth/google-button';

/**
 * The other way in, and the line that says it is another way.
 *
 * Both halves are gated on one server-side fact by the caller. Rendering a fixed
 * two-route layout would put "or continue with email" — and a Google button — on
 * a deployment with no `AUTH_GOOGLE_ID`, which is a button that can only error.
 * The separator is not decoration: it is the second half of a choice that exists
 * only when there are two routes to choose between.
 *
 * One component because it was copied verbatim into `/login` and `/register`, and
 * a divider whose wording drifts between the two screens that show it is the kind
 * of difference nobody notices and nobody intended.
 *
 * **Not `async`, and the label comes in as a prop.** Both callers already have `t`,
 * and an async component inside their `<Suspense>` boundary never resolves under
 * `renderToStaticMarkup` — the boundary falls back to `null` and takes the whole
 * card with it, form and links included. That is exactly what happened when this
 * awaited `getT()` itself.
 */
export function AuthDivider({ label }: { label: string }) {
  return (
    <>
      <GoogleButton />
      <div className="flex items-center gap-3" aria-hidden>
        <span className="bg-border h-px flex-1" />
        <span className="text-muted-foreground text-hint">{label}</span>
        <span className="bg-border h-px flex-1" />
      </div>
    </>
  );
}
