import fs from "node:fs";

export function readSupabaseEnv() {
  const text = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : "";
  const instagramCookieFile = fs.existsSync("ig_cookie.txt") ? fs.readFileSync("ig_cookie.txt", "utf8").trim() : "";
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
  const accessToken =
    env.SUPABASE_ACCESS_TOKEN ||
    entries.supabase_access_token ||
    entries.access_token ||
    env.ACCESS_TOKEN;
  const supabaseUrl = env.SUPABASE_URL || entries.supabase_url || (projectId ? `https://${projectId}.supabase.co` : "");

  return {
    projectId,
    supabaseUrl,
    anonKey,
    serviceRoleKey,
    secret,
    accessToken,
    instagramCookie: env.IG_COOKIE || entries.ig_cookie || entries.instagram_cookie || instagramCookieFile || "",
    gmailClientId: env.GMAIL_CLIENT_ID || entries.gmail_client_id || "",
    gmailClientSecret: env.GMAIL_CLIENT_SECRET || entries.gmail_client_secret || "",
    gmailRefreshToken: env.GMAIL_REFRESH_TOKEN || entries.gmail_refresh_token || "",
    gmailSenderEmail: env.GMAIL_SENDER_EMAIL || entries.gmail_sender_email || "",
    gmailSenderName: env.GMAIL_SENDER_NAME || entries.gmail_sender_name || "",
  };
}
