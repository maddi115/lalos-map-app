import { supabase } from '$lib/supabaseClient.js';
import { error, json } from '@sveltejs/kit';

export async function GET({ cookies }) {
  const deviceId = cookies.get('deviceId');

  if (!deviceId) {
    // If there's no cookie, it's not an error, there's just no user post.
    return json({ post: null });
  }

  const { data: post, error: dbError } = await supabase
    .from('posts')
    .select('id, lat, lng, image_url, comment, usercenter, natsize, pxatplace')
    .eq('deviceid', deviceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (dbError) {
    console.error('API /me error:', dbError);
    throw error(500, 'Database error');
  }

  return json({ post });
}