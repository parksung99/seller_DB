import http from "node:http";
import fs from "node:fs/promises";
import {
  handleError,
  listCandidates,
  readBody,
  sendJson,
  stats,
  updateCandidate,
  verifyAccessCode,
} from "./review_api.mjs";

const PORT = Number(process.env.PORT || 4317);

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
      verifyAccessCode(request);
      sendJson(response, 200, await listCandidates(url));
      return;
    }

    if (url.pathname.match(/^\/api\/candidates\/\d+$/) && request.method === "PATCH") {
      const id = url.pathname.split("/").at(-1);
      const body = await readBody(request);
      verifyAccessCode(request, body);
      sendJson(response, 200, await updateCandidate(id, body, body.actor));
      return;
    }

    if (url.pathname === "/api/stats" && request.method === "GET") {
      verifyAccessCode(request);
      sendJson(response, 200, await stats());
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
