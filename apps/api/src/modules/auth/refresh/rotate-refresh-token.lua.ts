/**
 * The rotation script — validate, invalidate and re-issue in ONE atomic step.
 *
 * A `.ts` module exporting a template string rather than a `.lua` asset, and
 * that is not a style choice: `nest build` copies no non-TS assets without
 * extra config, so a `.lua` file would work in dev and be missing from the
 * Docker image — a failure that appears only in production.
 *
 * WHY EVAL AT ALL. The branch set — spent-inside-grace re-issues, spent-outside
 * forgives-and-bumps, active rotates, bad lineage revokes — has to be decided
 * and applied without another client interleaving. `WATCH`/`MULTI` cannot
 * branch mid-transaction and `GETDEL` is single-key.
 *
 * THE THEFT SIGNAL IS LINEAGE, NOT THE CLOCK. There are two lossy legs on a
 * refresh and the second has no client-side bound at all: if the browser never
 * receives the response, the `Set-Cookie` is lost and nothing says when that
 * spent token is next presented — seconds if the user is active, hours if the
 * laptop lid was closed. A time window that covered it would have to be
 * unbounded, which is the same as having no detection. So `gen` and `epoch`
 * decide: a token presented after a LATER generation was already used is a
 * second party, because rotation fires 60 s before expiry and a freshly issued
 * leaf is not presented again for ~14 minutes, while a stale write from a
 * timed-out burst member lands within ~5 s. Those timescales do not overlap.
 *
 * THE TRAP, WRITTEN DOWN SO IT IS NOT REINVENTED. In the grace branch, do NOT
 * follow `replacedBy` and spend the replacement. That variant leaves only the
 * newest leaf active, so after N racing tabs the browser keeps whichever
 * `Set-Cookie` landed last and holds a SPENT token with probability ~(N-1)/N;
 * its next refresh, more than a grace window later, is indistinguishable from
 * reuse, the family is revoked, and every user is signed out. It cannot be
 * caught by a test that only asserts both racing refreshes succeeded — the
 * failure appears on the refresh AFTER that. Grace issues a fresh sibling and
 * leaves the presented record exactly as it found it.
 *
 * TWO LINEAGE VERDICTS, AND THEY ARE NOT THE SAME VERDICT. This is the one
 * place the script deliberately answers a lineage failure gently:
 *
 * - `gen < lastUsedGen` — a token presented after a LATER generation was
 *   already used. The timescales cannot overlap for one browser (see above), so
 *   this is two parties: `reuse`, family revoked, sockets closed.
 * - `epoch < fam.epoch` — an orphan of a token that was forgiven. It answers
 *   `orphaned`: that token alone dies, the family lives, and nothing is logged
 *   as theft.
 *
 * The split exists because the server CANNOT tell a lost successor from a held
 * one — "the browser is holding n1" and "n1 was lost in transit" are the same
 * Redis state. Treating both as theft meant an ordinary duplicate refresh
 * arriving more than the grace window late (a slow mobile leg, a suspended tab,
 * a retried request) revoked the family and dropped that user's meeting on every
 * device, ~14 minutes later, logged as a theft that never happened.
 *
 * STATE WHAT THIS GIVES UP, because it is not free. Under the old behaviour, a
 * thief who forced a forgiveness orphaned the victim's live successor, the
 * victim's next renewal read as `reuse`, and the family — thief's token included
 * — died. Now the victim is bounced to a fresh sign-in and the thief's leaf
 * survives in the old family until it expires. What the thief no longer gets is
 * a free family-wide revocation: presenting an orphaned token is simply refused.
 * The gen check above is untouched, and it is the one the timescale argument
 * actually proves.
 *
 * THE OLD RECORD KEEPS ITS OWN TTL. It is never re-expired here. Shortening it
 * would blind detection: an expired record answers `notfound`, which is not the
 * same answer as `reuse`.
 *
 * SINGLE-INSTANCE REDIS. The family key is derived inside the script rather
 * than passed in KEYS, which is fine on one node. IF CLUSTER EVER APPEARS,
 * `<familyId>` must become the hash tag on BOTH keys so they land in one slot.
 *
 * KEYS[1] = rt:<sha256(presented token)>
 * ARGV[1] = sha256(new token)   ARGV[2] = now, epoch seconds
 * ARGV[3] = token ttl ceiling   ARGV[4] = grace seconds
 *
 * Returns:
 *   { 'rotated' | 'grace' | 'recovered', userId, familyId, familyIssuedAt, newTokenTtl }
 *   { 'reuse', userId }  |  { 'orphaned' }  |  { 'revoked' }  |  { 'notfound' }  |  { 'expired' }
 */
export const ROTATE_REFRESH_TOKEN_LUA = `
local function tomap(flat)
  local map = {}
  for i = 1, #flat, 2 do map[flat[i]] = flat[i + 1] end
  return map
end

local tok = tomap(redis.call('HGETALL', KEYS[1]))
if tok.familyId == nil then return { 'notfound' } end

local famKey = 'rtfam:' .. tok.familyId
local fam = tomap(redis.call('HGETALL', famKey))
if fam.userId == nil then return { 'expired' } end
if fam.revoked == '1' then return { 'revoked' } end

local now = tonumber(ARGV[2])
local famTtl = (tonumber(fam.famExpiresAt) or 0) - now
if famTtl <= 0 then return { 'expired' } end

-- Lineage first: these outrank every status branch below.
local tokEpoch = tonumber(tok.epoch) or 0
local famEpoch = tonumber(fam.epoch) or 0
local tokGen = tonumber(tok.gen) or 0
local lastUsedGen = tonumber(fam.lastUsedGen) or 0

-- Checked FIRST, because it is the verdict that can be proven. A token used
-- after a later generation already was is two parties, whatever its epoch says.
if tokGen < lastUsedGen then
  -- Read the subject BEFORE the revoke write. The caller fires
  -- SessionTerminator on exactly this branch, and a verdict with no subject
  -- makes that call unimplementable.
  local thiefOwner = fam.userId
  redis.call('HSET', famKey, 'revoked', '1')
  return { 'reuse', thiefOwner }
end

-- An orphan of a forgiven ancestor. Refuse THIS token and nothing else: the
-- family is untouched, no sockets close, and no subject is returned, because
-- there is nothing here for the caller to act on beyond a 401.
if tokEpoch < famEpoch then
  return { 'orphaned' }
end

local outcome
local newEpoch = famEpoch

if tok.status == 'spent' then
  local spentAt = tonumber(tok.spentAt) or 0
  if (now - spentAt) <= tonumber(ARGV[4]) then
    -- One burst, several tabs. Issue a sibling and leave this record alone:
    -- no re-mark, no following replacedBy.
    outcome = 'grace'
  else
    -- A response the browser never received, surfacing late. Forgive it once,
    -- and orphan whatever successor it never saw by moving the family on.
    newEpoch = redis.call('HINCRBY', famKey, 'epoch', 1)
    outcome = 'recovered'
  end
else
  redis.call('HSET', KEYS[1], 'status', 'spent', 'spentAt', ARGV[2], 'replacedBy', ARGV[1])
  redis.call('HSET', famKey, 'lastUsedGen', tostring(tokGen))
  outcome = 'rotated'
end

local newTtl = math.min(tonumber(ARGV[3]), famTtl)
local newKey = 'rt:' .. ARGV[1]
redis.call('HSET', newKey,
  'familyId', tok.familyId,
  'status', 'active',
  'gen', tostring(tokGen + 1),
  'epoch', tostring(newEpoch),
  'spentAt', '',
  'replacedBy', '')
redis.call('EXPIRE', newKey, newTtl)
-- Re-set, never extended: famExpiresAt is absolute, so this is the remaining
-- life and not a sliding window.
redis.call('EXPIRE', famKey, famTtl)

return { outcome, fam.userId, tok.familyId, fam.issuedAt, tostring(newTtl) }
`;

/**
 * Marks a family revoked, and ONLY if it already exists.
 *
 * A bare `HSET` would create the key: a family that had expired would come back
 * as a TTL-less hash holding one field, leaking a key forever and turning a
 * later `expired` verdict into `revoked`. Both answer 401, so the bug would be
 * invisible until the memory bill arrived.
 *
 * KEYS[1] = rtfam:<familyId>   → 1 if it was revoked, 0 if there was nothing to revoke
 */
export const REVOKE_FAMILY_LUA = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('HSET', KEYS[1], 'revoked', '1')
return 1
`;

/**
 * Sign-out: resolve a presented token to its family and revoke that family.
 *
 * One round trip, and it deliberately reports nothing useful about WHY it
 * failed — the endpoint above it answers 204 either way, so an unknown token
 * and a just-revoked one are indistinguishable to a caller and this is not an
 * oracle for "is my token still live".
 *
 * KEYS[1] = rt:<sha256(token)>   → 1 if a family was revoked, else 0
 */
export const REVOKE_BY_TOKEN_LUA = `
local familyId = redis.call('HGET', KEYS[1], 'familyId')
if not familyId then return 0 end
local famKey = 'rtfam:' .. familyId
if redis.call('EXISTS', famKey) == 0 then return 0 end
redis.call('HSET', famKey, 'revoked', '1')
return 1
`;
