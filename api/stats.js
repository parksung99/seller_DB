import { handleError, sendJson, stats, verifyAccessCode } from "../scripts/review_api.mjs";

export default async function handler(request, response) {
  try {
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "method not allowed" });
      return;
    }

    verifyAccessCode(request);
    sendJson(response, 200, await stats());
  } catch (error) {
    handleError(response, error);
  }
}
