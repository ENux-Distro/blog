// Supabase connection. Both values are PUBLIC by design and safe to commit:
// the anon key can only do what the row-level-security rules in
// supabase/schema.sql allow. Never put the "service_role" key here.
// Find them in Supabase: Project Settings -> API.
window.BLOG_CONFIG = {
  SUPABASE_URL: "https://ipichnuwwthxpghoqsnn.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_n7FGnVuf4sAAz0hmmZ386w_8JkhVd8a",
};
