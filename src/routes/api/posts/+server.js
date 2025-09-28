import { json, error } from '@sveltejs/kit';
import { supabase } from '$lib/supabaseClient.js';

export async function GET({ url }) {
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));

  if (isNaN(lat) || isNaN(lng)) {
    throw error(400, 'Latitude (lat) and Longitude (lng) are required');
  }

  // Call the database function we just created
  const { data, error: dbError } = await supabase.rpc('nearby_posts', { lat, lng });

  if (dbError) {
    throw error(500, 'Database error: ' + dbError.message);
  }

  return json(data);
}