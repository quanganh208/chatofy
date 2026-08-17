/**
 * Whether listening through playback may be switched on in this build.
 *
 * This used to be `process.env.NODE_ENV !== 'production'`, which asked the wrong
 * question. Whether the microphone may stay open while the loudspeaker plays is
 * not a fact about the build channel — it is a fact about the DEVICE, and the
 * only thing that establishes it is the acoustic measurement in
 * `docs/development-journey.md`, section 10 item 1: twenty turns with full duplex on,
 * counting how many of them the microphone opened on our own audio, against a
 * half-duplex control. Pass is 0/20, and the reading is one-way — a pass on a
 * harder rig implies the easier ones, a failure implies nothing.
 *
 * Until that measurement has been taken on the machine a build runs on, the only
 * safe answer is no, and getting it wrong does not show up as an error: the
 * loudspeaker feeds the microphone, the app translates its own voice, and it does
 * so in front of whoever is watching.
 *
 * Deliberately NOT routed through `./env.ts`. That module runs `envSchema.parse`
 * at import time, so every value it exposes is a runtime lookup and `if (env.X)`
 * survives into the bundle — which would quietly cost this flag the property it
 * exists for. Compared against a literal here, a build whose variable says
 * anything other than `true` folds the branch away.
 *
 * Set the variable EXPLICITLY (see `.env.example`) rather than leaving it unset.
 * The safety property holds either way — this constant is evaluated at import, so
 * an absent variable is `false` at runtime — but Next builds its substitution map
 * from the `NEXT_PUBLIC_*` keys actually present at build time, so an absent one
 * may survive as a property read instead of folding. Present value: the stronger
 * "no path in the bundle" claim is real. Absent: only the runtime guarantee is.
 */
export const FULL_DUPLEX_CLEARED = process.env.NEXT_PUBLIC_FULL_DUPLEX_CLEARED === 'true';

/**
 * Whether this build is being used to take measurements.
 *
 * Turns on two things that are useless in ordinary use and required for the
 * acoustic protocol in `docs/development-journey.md` section 10 item 1: the
 * per-run echo count on screen, and per-turn rows sent to the server's JSONL
 * sink.
 *
 * Off by default because the rows are the only data this client writes to the
 * server's disk, and because a counter nobody is reading is just clutter. The
 * server gates the same channel again behind `TURN_METRICS_PATH`, so both ends
 * have to be switched on deliberately.
 */
export const MEASUREMENT_MODE = process.env.NEXT_PUBLIC_MEASUREMENT_MODE === 'true';
