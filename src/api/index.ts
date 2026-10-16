/**
 * Routes a request to /chart, /bulk, /neck, /document, or /triads. These
 * used to be HTTP endpoints on a Lambda; they're now plain functions the
 * web UI calls in the browser (see ../browser/engine.ts), keeping the same
 * request shapes so the UI's form-to-request code didn't have to change.
 */

import { handleChart } from "./chart";
import { handleBulk } from "./bulk";
import { handleNeck } from "./neck";
import { handleDocument } from "./document";
import { handleTriads } from "./triads";
import { invalid, errorResult, ApiResult } from "./result";

export type { ApiResult, RenderOutput } from "./result";

const ROUTES: Record<string, (body: unknown) => ApiResult> = {
  "/chart": handleChart,
  "/bulk": handleBulk,
  "/neck": handleNeck,
  "/document": handleDocument,
  "/triads": handleTriads,
};

export function handleRequest(route: string, body: unknown): ApiResult {
  const handle = ROUTES[route];
  if (!handle) return invalid(`unknown route: ${route}`);
  try {
    return handle(body);
  } catch (err) {
    return errorResult(err);
  }
}
