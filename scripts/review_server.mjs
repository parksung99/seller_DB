import http from "node:http";
import fs from "node:fs/promises";
import {
  handleError,
  addCampaignRecipients,
  createCampaign,
  createCandidate,
  deleteCampaign,
  getCampaign,
  listCandidates,
  listCampaigns,
  listExcludedDb,
  readBody,
  sendJson,
  sendCampaign,
  stats,
  syncCampaignReplies,
  updateCampaign,
  updateCampaignRecipient,
  updateCandidate,
} from "./review_api.mjs";

const PORT = Number(process.env.PORT || 4320);

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/review_app.html") {
      const html = await fs.readFile("index.html", "utf8");
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }

    if (url.pathname === "/api/candidates" && request.method === "GET") {
      sendJson(response, 200, await listCandidates(url));
      return;
    }

    if (url.pathname === "/api/candidates" && request.method === "POST") {
      const body = await readBody(request);
      sendJson(response, 200, await createCandidate(body, body.actor));
      return;
    }

    if (url.pathname.match(/^\/api\/candidates\/\d+$/) && request.method === "PATCH") {
      const id = url.pathname.split("/").at(-1);
      const body = await readBody(request);
      sendJson(response, 200, await updateCandidate(id, body, body.actor));
      return;
    }

    if (url.pathname === "/api/stats" && request.method === "GET") {
      sendJson(response, 200, await stats());
      return;
    }

    if (url.pathname === "/api/excluded" && request.method === "GET") {
      sendJson(response, 200, await listExcludedDb(url));
      return;
    }

    if (url.pathname === "/api/campaigns" && request.method === "GET") {
      sendJson(response, 200, await listCampaigns());
      return;
    }

    if (url.pathname === "/api/campaigns" && request.method === "POST") {
      const body = await readBody(request);
      sendJson(response, 200, await createCampaign(body, body.actor));
      return;
    }

    if (url.pathname.match(/^\/api\/campaigns\/\d+$/) && request.method === "GET") {
      const id = url.pathname.split("/").at(-1);
      sendJson(response, 200, await getCampaign(id));
      return;
    }

    if (url.pathname.match(/^\/api\/campaigns\/\d+$/) && request.method === "PATCH" && url.searchParams.get("action") === "recipient") {
      const id = url.pathname.split("/").at(-1);
      const body = await readBody(request);
      sendJson(response, 200, await updateCampaignRecipient(id, url.searchParams.get("recipient_id"), body));
      return;
    }

    if (url.pathname.match(/^\/api\/campaigns\/\d+$/) && request.method === "PATCH") {
      const id = url.pathname.split("/").at(-1);
      const body = await readBody(request);
      sendJson(response, 200, await updateCampaign(id, body));
      return;
    }

    if (url.pathname.match(/^\/api\/campaigns\/\d+$/) && request.method === "DELETE") {
      const id = url.pathname.split("/").at(-1);
      sendJson(response, 200, await deleteCampaign(id));
      return;
    }

    if (url.pathname.match(/^\/api\/campaigns\/\d+\/recipients$/) && request.method === "POST") {
      const id = url.pathname.split("/").at(-2);
      const body = await readBody(request);
      sendJson(response, 200, await addCampaignRecipients(id, body));
      return;
    }

    if (url.pathname.match(/^\/api\/campaigns\/\d+\/recipients\/\d+$/) && request.method === "PATCH") {
      const parts = url.pathname.split("/");
      const body = await readBody(request);
      sendJson(response, 200, await updateCampaignRecipient(parts.at(-3), parts.at(-1), body));
      return;
    }

    if (url.pathname.match(/^\/api\/campaigns\/\d+\/send$/) && request.method === "POST") {
      const id = url.pathname.split("/").at(-2);
      sendJson(response, 200, await sendCampaign(id));
      return;
    }

    if (url.pathname.match(/^\/api\/campaigns\/\d+\/sync-replies$/) && request.method === "POST") {
      const id = url.pathname.split("/").at(-2);
      sendJson(response, 200, await syncCampaignReplies(id));
      return;
    }

    sendJson(response, 404, { error: "not found" });
  } catch (error) {
    handleError(response, error);
  }
});

server.listen(PORT, () => {
  console.log(`[review] http://localhost:${PORT}`);
});
