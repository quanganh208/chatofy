/**
 * What every microphone that has to survive our own playback asks the browser for.
 *
 * One constant rather than three literals because the value is not
 * self-explanatory and the reason it is needed is not either. A copy per app
 * would be three chances to write it wrong, and the first draft in the extension
 * proved that is not theoretical.
 *
 * Plain `echoCancellation: true` does NOT cover the loop this project has. Chrome
 * builds its cancellation reference from remote peer-connection audio and not
 * from what a page renders through Web Audio — and the translation every surface
 * here speaks is exactly that. So the canceller runs, reports itself on, and
 * removes none of it.
 *
 * `"all"` (Chrome 141) removes system playout from the microphone signal instead,
 * which does cover it. It is a VALUE of `echoCancellation`, not a member beside
 * it: Chrome widened that one property from `ConstrainBoolean` to
 * `ConstrainBooleanOrDOMString`, and `EchoCancellationModeEnum` is only the name
 * of the enum the strings come from. Written as a member of its own it is a
 * dictionary key nobody reads — dropped in silence, no error, no effect.
 *
 * Degrades on its own: a browser whose `echoCancellation` is still boolean-only
 * converts the string by WebIDL rules and gets `true`, which is what shipped
 * before this existed.
 *
 * Whether it is honoured is a measurement, not an assumption. Read what was
 * GRANTED back from `track.getSettings().echoCancellation` — `true` there means
 * the string was coerced and this platform does not have the mode, which must
 * not be reported as success.
 *
 * Deliberately NOT for a microphone whose job is to MEASURE echo. Cancelling our
 * playout out of the measurement leaves it measuring nothing.
 */
export const ECHO_CANCELLATION_ALL = 'all';

/**
 * The constraint value, typed for a `lib.dom` that still says boolean.
 *
 * Cast on the value alone. Casting the whole constraint object switches off
 * excess-property checking for every member in it, which is how a constraint
 * member that does not exist shipped once already.
 */
export const echoCancellationAll = ECHO_CANCELLATION_ALL as unknown as ConstrainBoolean;
