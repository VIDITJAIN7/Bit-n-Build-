import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const authClient = url && key
  ? createClient(url, key, {
      auth: { autoRefreshToken: true, detectSessionInUrl: true, persistSession: true },
    })
  : null;

export const remoteAuthEnabled = authClient !== null;
