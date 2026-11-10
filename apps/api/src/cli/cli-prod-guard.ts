// The one check every credits CLI command passes before it touches the
// database it was pointed at.
//
// Only a local database on a port other than 5433 runs without asking. 5433 is
// the production Postgres published on the deploy host, so a dev shell holding
// a tunnel to it is NOT local. Inside the production container the database is
// `postgres:5432`, which is not local either — a guard keyed only on 5433 would
// never fire there. Any non-local database needs `--prod`; a command that
// writes also needs the operator to type the subject (an email or an id) back,
// which cannot happen without a terminal.

export interface CliDatabase {
  host: string;
  port: string;
  local: boolean;
}

/** The production Postgres port on the deploy host; never treated as local. */
export const PROD_TUNNEL_PORT = '5433';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** A refusal the CLI prints and exits non-zero on. */
export class CliRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliRefusal';
  }
}

export function describeDatabase(databaseUrl: string): CliDatabase {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new CliRefusal('DATABASE_URL is not a valid URL.');
  }
  const host = url.hostname;
  const port = url.port || '5432';
  return {
    host,
    port,
    local: LOCAL_HOSTS.has(host) && port !== PROD_TUNNEL_PORT,
  };
}

export interface GuardIo {
  isTTY: boolean;
  print: (line: string) => void;
  ask: (question: string) => Promise<string>;
}

export interface GuardInput {
  databaseUrl: string;
  prod: boolean;
  /** What the command will do, printed before the confirmation. */
  action: string;
  /** What the operator must type back; omit for a read-only command. */
  confirmWith?: string;
}

export async function guardDatabase(
  input: GuardInput,
  io: GuardIo,
): Promise<CliDatabase> {
  const db = describeDatabase(input.databaseUrl);
  if (db.local) return db;
  if (!input.prod) {
    throw new CliRefusal(
      `Refusing: the database ${db.host}:${db.port} is not a local development database. ` +
        'Re-run with --prod if that is intended.',
    );
  }
  if (input.confirmWith === undefined) return db;
  if (!io.isTTY) {
    throw new CliRefusal(
      'Refusing: --prod needs a terminal to confirm in (run with docker exec -it).',
    );
  }
  io.print(`Database: ${db.host}:${db.port}`);
  io.print(`Action:   ${input.action}`);
  const typed = (
    await io.ask(`Type ${input.confirmWith} to continue: `)
  ).trim();
  if (typed !== input.confirmWith)
    throw new CliRefusal('Not confirmed; nothing was written.');
  return db;
}
