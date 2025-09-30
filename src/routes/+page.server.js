import { supabase } from '$lib/supabaseClient';

export async function load({ cookies }) {
  const deviceId = cookies.get('deviceId');

  if (!deviceId) {
    return {
      post: null
    };
  }

  // CRUCIAL FIX: Select lowercase columns that match the database schema (snake_case)
  const { data: post, error } = await supabase
    .from('posts')
    // Use all lowercase column names for the query
    .select('id, lat, lng, image_url, comment, usercenter, natsize, pxatplace, deviceid')
    .eq('deviceid', deviceId) // FIX: use lowercase 'deviceid' for the WHERE clause
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) { 
    console.error('Supabase query error:', error);
  }

  // Convert DB snake_case back to client camelCase for easy use in Svelte
  const restoredPost = post ? {
      ...post,
      userCenter: post.usercenter,
      natSize: post.natsize,
      pxAtPlace: post.pxatplace,
      deviceId: post.deviceid
  } : null;

  return {
    post: restoredPost ?? null,
  };
}
