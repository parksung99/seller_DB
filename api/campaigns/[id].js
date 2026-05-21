import {
  addCampaignRecipients,
  deleteCampaign,
  getCampaign,
  handleError,
  sendCampaign,
  sendJson,
  syncCampaignReplies,
  updateCampaign,
} from "../../scripts/review_api.mjs";

export default async function handler(request, response) {
  try {
    const id = request.query.id;
    const action = request.query.action || "";
    const body =
      typeof request.body === "string"
        ? JSON.parse(request.body || "{}")
        : request.body && typeof request.body === "object"
          ? request.body
          : {};

    if (!action && request.method === "GET") {
      sendJson(response, 200, await getCampaign(id));
      return;
    }
    if (!action && request.method === "PATCH") {
      sendJson(response, 200, await updateCampaign(id, body));
      return;
    }
    if (!action && request.method === "DELETE") {
      sendJson(response, 200, await deleteCampaign(id));
      return;
    }
    if (action === "recipients" && request.method === "POST") {
      sendJson(response, 200, await addCampaignRecipients(id, body));
      return;
    }
    if (action === "send" && request.method === "POST") {
      sendJson(response, 200, await sendCampaign(id));
      return;
    }
    if (action === "sync-replies" && request.method === "POST") {
      sendJson(response, 200, await syncCampaignReplies(id));
      return;
    }

    sendJson(response, 405, { error: "method not allowed" });
  } catch (error) {
    handleError(response, error);
  }
}
