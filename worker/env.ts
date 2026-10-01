// Must be imported first: loads .env (Next.js does this for the web app) and labels logs.
import "dotenv/config";

process.env.SERVICE_NAME ??= "worker";
