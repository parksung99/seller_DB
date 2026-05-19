import { createCandidate, handleError, listCandidates, sendJson, verifyAccessCode } from "../scripts/review_api.mjs";

export default async function handler(request, response) {
  try {
    if (request.method !== "GET" && request.method !== "POST") {
      sendJson(response, 405, { error: "method not allowed" });
      return;
    }

    const body =
      typeof request.body === "string"
        ? JSON.parse(request.body || "{}")
        : request.body && typeof request.body === "object"
          ? request.body
          : {};
    verifyAccessCode(request, body);
    if (request.method === "POST") {
      sendJson(response, 200, await createCandidate(body, body.actor));
      return;
    }
    const url = new URL(request.url, `https://${request.headers.host || "localhost"}`);
    sendJson(response, 200, await listCandidates(url));
  } catch (error) {
    handleError(response, error);
  }
}
