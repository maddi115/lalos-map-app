import { json, error } from '@sveltejs/kit';
import { supabase } from '$lib/supabaseClient.js';

console.log('✓ POSTS +server.js loaded - GET/POST/PATCH available');
/**
 * Handles GET requests to fetch nearby posts.
 */
export async function GET({ url }) {
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));

  if (isNaN(lat) || isNaN(lng)) {
    throw error(400, 'Latitude (lat) and Longitude (lng) are required');
  }

  // Assuming 'nearby_posts' is a custom function in your DB that handles proximity search
  const { data, error: dbError } = await supabase.rpc('nearby_posts', { lat, lng });

  if (dbError) {
    throw error(500, 'Database error: ' + dbError.message);
  }

  return json(data);
}

/**
 * Handles POST requests to create a new post, saving all state data for restoration.
 */
export async function POST({ request, cookies }) {
  const { comment, lat, lng, image_url, userCenter, natSize, pxAtPlace } = await request.json();
  
  const deviceId = cookies.get('deviceId');

  if (!deviceId) {
      throw error(401, 'Device ID required for post creation.');
  }

  const postData = {
      comment,
      lat,
      lng,
      image_url,
      // CRUCIAL FIX: ALL keys for the database are set to lowercase
      deviceid: deviceId, 
      usercenter: userCenter || null,
      natsize: natSize || null,
      pxatplace: pxAtPlace ?? 8 
  };

  const { data: newPost, error: postError } = await supabase
    .from('posts')
    .insert([postData])
    .select('id, lat, lng, comment, image_url')
    .single();

  if (postError) {
    console.error("Supabase POST error:", postError);
    throw error(500, 'Failed to create post: ' + postError.message);
  }

  return json(newPost);
}

/**
 * Handles PATCH requests to update an existing post by ID using a query parameter (?id=X).
 */
export async function PATCH({ url, request, cookies }) {
    const id = url.searchParams.get('id'); // FIX: Get ID from query parameter

    if (!id) {
        throw error(400, 'Post ID query parameter (?id=X) is required for update.');
    }
    
    const body = await request.json();
    
    const patchData = {};
    if (body.comment !== undefined) patchData.comment = body.comment;
    if (body.pxAtPlace !== undefined) patchData.pxatplace = body.pxAtPlace; // Lowercase DB column

    if (Object.keys(patchData).length === 0) {
        throw error(400, 'No valid fields provided for update.');
    }

    const deviceId = cookies.get('deviceId');

    if (!deviceId) {
        throw error(401, 'Device ID required for update verification.');
    }

    const { data, error: dbError } = await supabase
        .from('posts')
        .update(patchData)
        .eq('id', id)
        .eq('deviceid', deviceId) // Lowercase 'deviceid' for security check
        .select('id')
        .maybeSingle();

    if (dbError) {
        console.error("Supabase PATCH error:", dbError);
        throw error(500, 'Failed to update post: ' + dbError.message);
    }
    
    if (!data) {
        // This means the row wasn't found or the deviceId didn't match the row's owner.
        throw error(404, 'Post not found or permission denied.');
    }

    return json({ success: true, id: data.id });
}
