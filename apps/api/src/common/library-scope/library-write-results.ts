/**
 * Building blocks for library store results. Each store method declares its
 * OWN union from these, so a method can only return the outcomes it can
 * actually produce, and a service switch over it is checked exhaustively.
 */
export type Saved<T> = { kind: 'saved'; value: T };
export type Refusal<K extends string> = { kind: K };
/** What a delete did. Personal routes answer 204 for both removed and absent. */
export type RemoveResult = 'removed' | 'absent' | 'forbidden';
/** The default branch of an exhaustive switch: compiles only when every kind is handled. */
export function assertNever(value: never): never {
  throw new Error(`unhandled library write result: ${JSON.stringify(value)}`);
}
