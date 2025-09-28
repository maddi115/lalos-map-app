// src/routes/+page.js
import { supabase } from '$lib/supabaseClient'

export async function load() {
  // The fix is here: added the equals sign
  const { data } = await supabase.from('posts').select('*')
  
  return {
    posts: data ?? []
  }
}