import { createClient } from "@supabase/supabase-js";
import { previewMode } from "./preview";

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const authClient = !previewMode && url && key
  ? createClient(url, key, {
      auth: { autoRefreshToken: true, detectSessionInUrl: true, persistSession: true },
    })
  : null;

export const remoteAuthEnabled = authClient !== null;
