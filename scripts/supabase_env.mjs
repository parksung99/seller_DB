import fs from "node:fs";

export function readSupabaseEnv() {
  const text = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
  const entries = Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^([^:=]+)\s*[:=]\s*(.*)$/);
        if (!match) return null;
        return [match[1].trim().toLowerCase().replace(/\s+/g, "_"), match[2].trim()];
      })
      .filter(Boolean)
  );

  const env = process.env;
  const projectId = env.SUPABASE_PROJECT_ID || entries.project_id || entries.supabase_project_id;
  const anonKey = env.SUPABASE_ANON_KEY || entries.anon_key || entries.supabase_anon_key;
  const serviceRoleKey =
    env.SUPABASE_SERVICE_ROLE_KEY ||
    entries.service_role ||
    entries.service_role_key ||
    entries.supabase_service_role_key;
  const secret = env.SUPABASE_SECRET || entries.secret || entries.supabase_secret;
  const supabaseUrl = env.SUPABASE_URL || entries.supabase_url || (projectId ? `https://${projectId}.supabase.co` : "");

  return {
    projectId,
    supabaseUrl,
    anonKey,
    serviceRoleKey,
    secret,
    teamAccessCode: env.TEAM_ACCESS_CODE || entries.team_access_code || "",
  };
}
