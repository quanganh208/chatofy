/**
 * mint-bench-token.mjs
 * Logs in as the bench user and prints the accessToken to stdout.
 * Usage: node scripts/mint-bench-token.mjs
 * Reads BENCH_EMAIL / BENCH_PASSWORD from env or uses defaults.
 */
const email = process.env['BENCH_EMAIL'] ?? 'bench@dev.local';
const password = process.env['BENCH_PASSWORD'] ?? 'Benchmark123!';
const apiBase = process.env['API_BASE_URL'] ?? 'http://localhost:3000';

const resp = await fetch(`${apiBase}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});

if (!resp.ok) {
  const text = await resp.text();
  process.stderr.write(`Login failed (${resp.status}): ${text}\n`);
  process.exit(1);
}

const body = await resp.json();
const token = body?.data?.token?.accessToken;
if (!token) {
  process.stderr.write(`Unexpected response shape: ${JSON.stringify(body)}\n`);
  process.exit(1);
}

process.stdout.write(token);
