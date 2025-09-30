import { json, error } from '@sveltejs/kit';
import { supabase } from '$lib/supabaseClient.js';

/**
 * Fetches posts created by the current user's device ID.
 * It expects the unique device ID to be passed in the 'X-Device-Id' header.
 */
export async function GET({ request }) {
  // Get the device ID from the header
  const deviceId = request.headers.get('x-device-id');

  if (!deviceId) {
    throw error(400, 'Device ID header is missing.');
  }

  // Query the database, filtering for posts matching the device ID
  const { data, error: dbError } = await supabase
    .from('posts')
    .select('*')
    .eq('deviceId', deviceId) // Filters posts by the device ID column
    .order('created_at', { ascending: false });

  if (dbError) {
    console.error('Database error fetching history:', dbError);
    throw error(500, 'Database error: ' + dbError.message);
  }

  return json(data);
}
