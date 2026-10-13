/**
 * A text field's value from a submitted form, or `''`.
 *
 * The auth forms read their fields here rather than from React state: a value typed
 * or autofilled before hydration exists only in the DOM (see `login-form.tsx`).
 * `FormData.get` can also return a `File`, which no text field submits; treating it as
 * empty keeps `[object File]` from ever reaching an API.
 */
export function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}
