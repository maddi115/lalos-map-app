import { supabase } from '$lib/supabaseClient';

export async function load() {
  // This function now ONLY loads the public posts for the map.
  const { data: posts, error } = await supabase
    .from('posts')
    .select('id, lat, lng, image_url, comment, natsize, pxatplace')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('Error loading public posts:', error);
    return { posts: [] };
  }

  return { posts: posts ?? [] };
}