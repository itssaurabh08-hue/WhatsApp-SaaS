import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";
import { EMAIL_LOG } from "./env";

interface CapturedEmail {
  to: string;
  subject: string;
  text: string;
}

/** Waits for an email to `to` and returns the first link matching `pathPrefix`. */
export async function waitForEmailLink(to: string, pathPrefix: string): Promise<string> {
  let link: string | undefined;
  await expect
    .poll(
      () => {
        const emails = JSON.parse(readFileSync(EMAIL_LOG, "utf8")) as CapturedEmail[];
        const email = [...emails].reverse().find((e) => e.to.includes(to) && e.text.includes(pathPrefix));
        link = email?.text.match(new RegExp(`https?://\\S+${pathPrefix}\\S*`))?.[0];
        return link;
      },
      { timeout: 15_000, message: `email to ${to} containing ${pathPrefix}` },
    )
    .toBeTruthy();
  return link!;
}
