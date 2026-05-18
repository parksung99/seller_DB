import fs from "node:fs/promises";
import { readSupabaseEnv } from "./supabase_env.mjs";

async function runManagementQuery({ projectId, token, sql }) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${projectId}/database/query`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });

  const text = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    text,
  };
}

async function main() {
  const env = readSupabaseEnv();
  const sql = await fs.readFile("supabase_schema.sql", "utf8");

  if (!env.projectId) {
    throw new Error("project_id or SUPABASE_PROJECT_ID is required.");
  }

  const tokens = [
    ["secret", env.secret],
    ["service_role", env.serviceRoleKey],
  ].filter(([, token]) => token);

  for (const [name, token] of tokens) {
    console.log(`[setup] Trying Management SQL API: ${name}`);
    const result = await runManagementQuery({ projectId: env.projectId, token, sql });
    console.log(`[setup] status: ${result.status}`);

    if (result.ok) {
      console.log("[done] Supabase table setup completed");
      return;
    }

    console.log(`[setup] Failed response: ${result.text.slice(0, 500)}`);
  }

  console.log("");
  console.log("[manual] Automatic table setup failed.");
  console.log("[manual] Run supabase_schema.sql in Supabase SQL Editor, then run the import script.");
  process.exit(2);
}

main().catch((error) => {
  console.error("[error]", error);
  process.exit(1);
});
