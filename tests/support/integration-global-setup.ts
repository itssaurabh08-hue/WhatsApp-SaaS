import { execSync } from "node:child_process";
import { TEST_DATABASE_URL } from "./test-env";

/** Applies migrations to the test database once before the integration suite. */
export default function setup() {
  if (!/test/i.test(new URL(TEST_DATABASE_URL).pathname)) {
    throw new Error(`Refusing to run integration tests against a non-test database: ${TEST_DATABASE_URL}`);
  }
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
