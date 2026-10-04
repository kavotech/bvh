import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
export const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || 'info@breezyeemoves.co.uk';

// Only create Supabase client if credentials are available
export const supabase = SUPABASE_URL && SUPABASE_ANON_KEY && SUPABASE_URL !== 'https://your-project.supabase.co'
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { fetch: (url, options = {}) => fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(30000) }) } })
  : null;
