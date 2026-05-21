import { handleError, listExcludedDb, sendJson } from "../scripts/review_api.mjs";

export default async function handler(request, response) {
  try {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "method not allowed" });
      return;
    }
    const url = new URL(request.url, `https://${request.headers.host || "localhost"}`);
    sendJson(response, 200, await listExcludedDb(url));
  } catch (error) {
    handleError(response, error);
  }
}
