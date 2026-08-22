import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Clients are created LAZILY on first use rather than at module scope: `next build`
// collects page data for every route, and a module-scope createClient("") throws
// during that phase even though the route would never run without a configured DB.
// Same runtime behavior — still throws on first real use when unconfigured — but
// builds/CI no longer require live Supabase credentials.
function requireEnv(v: string, name: string): string {
  if (!v) throw new Error(`${name} is required (set it in .env.local)`);
  return v;
}

let _supabase: SupabaseClient | null = null;
let _supabaseAdmin: SupabaseClient | null = null;

// Public client — safe for client-side use
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_t, prop, recv) {
    if (!_supabase) _supabase = createClient(requireEnv(url, "NEXT_PUBLIC_SUPABASE_URL"), requireEnv(anonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY"));
    const v = Reflect.get(_supabase as object, prop, _supabase);
    return typeof v === "function" ? v.bind(_supabase) : v;
  },
});

// Service client — server-side only, bypasses RLS
export const supabaseAdmin: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_t, prop, recv) {
    if (!_supabaseAdmin)
      _supabaseAdmin = createClient(requireEnv(url, "NEXT_PUBLIC_SUPABASE_URL"), requireEnv(serviceKey, "SUPABASE_SERVICE_ROLE_KEY"), {
        auth: { persistSession: false },
      });
    const v = Reflect.get(_supabaseAdmin as object, prop, _supabaseAdmin);
    return typeof v === "function" ? v.bind(_supabaseAdmin) : v;
  },
});
