import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { simpleParser } from "mailparser";
import pg from "pg";
import { SMTPServer } from "smtp-server";
import { E2E_DATABASE_URL, EMAIL_LOG, FAKE_GRAPH_PORT, SMTP_SINK_PORT } from "./env";
import { startFakeGraph } from "./fake-graph-server";

interface CapturedEmail {
  to: string;
  subject: string;
  text: string;
}

/**
 * Migrates and empties the e2e database and starts an SMTP sink that appends every received
 * email to EMAIL_LOG so tests can follow verification and reset links.
 */
export default async function globalSetup() {
  if (!/e2e|test/i.test(new URL(E2E_DATABASE_URL).pathname)) {
    throw new Error(`Refusing to reset a non-test database: ${E2E_DATABASE_URL}`);
  }
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL } });
  const client = new pg.Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'",
    );
    if (rows.length > 0) {
      await client.query(`TRUNCATE TABLE ${rows.map((r) => `"public"."${r.tablename}"`).join(", ")} CASCADE`);
    }
  } finally {
    await client.end();
  }

  mkdirSync(dirname(EMAIL_LOG), { recursive: true });
  const emails: CapturedEmail[] = [];
  writeFileSync(EMAIL_LOG, "[]");

  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ["STARTTLS"],
    onData(stream, _session, callback) {
      simpleParser(stream)
        .then((mail) => {
          const to = Array.isArray(mail.to) ? mail.to[0]?.text : mail.to?.text;
          emails.push({ to: to ?? "", subject: mail.subject ?? "", text: mail.text ?? "" });
          writeFileSync(EMAIL_LOG, JSON.stringify(emails, null, 2));
          callback();
        })
        .catch(callback);
    },
  });
  await new Promise<void>((resolve) => server.listen(SMTP_SINK_PORT, "127.0.0.1", resolve));
  const graph = await startFakeGraph(FAKE_GRAPH_PORT);

  return async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => graph.close(() => resolve()));
  };
}
