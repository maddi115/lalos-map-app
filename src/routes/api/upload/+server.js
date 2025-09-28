import { error } from '@sveltejs/kit';
import { supabase } from '$lib/supabaseClient.js';

/**
 * Handles the POST request for uploading a file to Supabase Storage.
 * Endpoint: /api/upload
 */
export async function POST({ request }) {
  const formData = await request.formData();
  const file = formData.get('file');

  if (!file) {
    throw error(400, 'No file uploaded.');
  }

  // Generate a unique file name to avoid conflicts
  const fileName = `${crypto.randomUUID()}-${file.name}`;

  console.log(`Attempting to upload file: ${fileName}`);

  // Upload the file to the 'posts' bucket
  const { data, error: uploadError } = await supabase.storage
    .from('posts')
    .upload(fileName, file); // <-- REMOVED OPTIONS HERE

  if (uploadError) {
    // CRUCIAL: Log the full error to the terminal
    console.error("--- SUPABASE UPLOAD FAILED ---");
    console.error("Error details:", uploadError);
    console.error("This usually means the 'posts' bucket is not public or the security policy is wrong.");
    console.error("------------------------------");
    
    // This throws the error back to the frontend
    throw error(500, 'Storage error: ' + uploadError.message);
  }

  // Get the public URL of the uploaded file
  const { data: { publicUrl } } = supabase.storage
    .from('posts')
    .getPublicUrl(fileName);

  console.log(`Upload successful. Public URL: ${publicUrl}`);

  // Return the URL to the browser
  return new Response(JSON.stringify({ url: publicUrl }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
