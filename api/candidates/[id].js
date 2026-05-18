import { handleError, sendJson, updateCandidate, verifyAccessCode } from "../../scripts/review_api.mjs";

export default async function handler(request, response) {
  try {
    if (request.method !== "PATCH") {
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
    sendJson(response, 200, await updateCandidate(request.query.id, body, body.actor));
  } catch (error) {
    handleError(response, error);
  }
}
