import { supabase } from '$lib/supabaseClient';
import { error, json } from '@sveltejs/kit';

export async function GET({ url }) {
  const id = url.searchParams.get('id');
  if (id) {
    const { data: post, error: dbError } = await supabase
      .from('posts')
      .select('*')
      .eq('id', id)
      .single();
    if (dbError) throw error(500, 'Database error');
    return json(post);
  }

  // If no ID is provided, return an empty array or handle as needed
  return json([]);
}

export async function POST({ request, cookies }) {
  try {
    const { lat, lng, comment, image_url, userCenter, natSize, pxAtPlace } = await request.json();

    const deviceid = cookies.get('deviceId');

    if (!lat || !lng || !image_url) {
      throw error(400, 'Missing required fields');
    }

    // This is the new line to create the PostGIS point
    const location = `POINT(${lng} ${lat})`;

    const { data, error: dbError } = await supabase
      .from('posts')
      .insert({
        lat,
        lng,
        location, // We now save the location column
        comment,
        image_url,
        usercenter: userCenter,
        natsize: natSize,
        pxatplace: pxAtPlace,
        deviceid: deviceid
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database insert error:', dbError);
      throw error(500, 'Database error');
    }

    return json(data);

  } catch (err) {
    console.error('API /items POST error:', err);
    throw error(500, 'Internal server error');
  }
}

export async function PATCH({ url, request }) {
  const id = url.searchParams.get('id');
  if (!id) {
    throw error(400, 'Missing post ID');
  }

  const updates = await request.json();

  const { data, error: dbError } = await supabase
    .from('posts')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (dbError) {
    console.error('Database update error:', dbError);
    throw error(500, 'Database error');
  }

  return json(data);
}