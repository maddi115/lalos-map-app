import { supabase } from '$lib/supabaseClient';
import { error, json } from '@sveltejs/kit';

export async function GET({ url }) {
  // Get the map boundary coordinates from the request URL
  const min_lon = parseFloat(url.searchParams.get('min_lon'));
  const min_lat = parseFloat(url.searchParams.get('min_lat'));
  const max_lon = parseFloat(url.searchParams.get('max_lon'));
  const max_lat = parseFloat(url.searchParams.get('max_lat'));

  if (!min_lon || !min_lat || !max_lon || !max_lat) {
    throw error(400, 'Missing map bounds');
  }

  // Call the database function we just created
  const { data, error: dbError } = await supabase.rpc('posts_in_view', {
    min_lon,
    min_lat,
    max_lon,
    max_lat
  });

  if (dbError) {
    console.error('API /near error:', dbError);
    throw error(500, 'Database error');
  }

  return json(data || []);
}