import { createCampaign, handleError, listCampaigns, sendJson } from "../scripts/review_api.mjs";

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
    if (request.method === "POST") {
      sendJson(response, 200, await createCampaign(body, body.actor));
      return;
    }
    sendJson(response, 200, await listCampaigns());
  } catch (error) {
    handleError(response, error);
  }
}
