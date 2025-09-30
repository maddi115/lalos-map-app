import { supabase } from '$lib/supabaseClient';

export async function load({ cookies }) {
  const deviceId = cookies.get('deviceId');
  // ADD THIS LINE
  console.log('Server received deviceId cookie:', deviceId);
  if (!deviceId) {
    return {
      post: null
    };
  }

  const { data: post, error } = await supabase
    .from('posts')
    .select('id, lat, lng, image_url, comment, usercenter, natsize, pxatplace, deviceid')
    .eq('deviceid', deviceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) { 
    console.error('Supabase query error:', error);
    return { post: null }; // Return null on error
  }

  // No conversion needed, just send the raw post object
  return {
    post: post ?? null
  };
}