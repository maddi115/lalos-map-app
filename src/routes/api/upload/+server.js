import { error } from '@sveltejs/kit';
import { supabase } from '$lib/supabaseClient.js';

export async function POST({ request }) {
  console.log('=== UPLOAD ENDPOINT HIT ===');
  console.log('Request headers:', Object.fromEntries(request.headers));
  
  try {
    console.log('Attempting to parse formData...');
    const formData = await request.formData();
    console.log('FormData parsed successfully');
    
    const file = formData.get('file');
    console.log('File from formData:', file ? `${file.name} (${file.size} bytes)` : 'NO FILE');
    
    if (!file) {
      console.log('ERROR: No file in request');
      throw error(400, 'No file uploaded.');
    }

    const fileName = `${crypto.randomUUID()}-${file.name}`;
    console.log(`Uploading: ${fileName}`);

    const { data, error: uploadError } = await supabase.storage
      .from('posts')
      .upload(fileName, file);

    if (uploadError) {
      console.error("SUPABASE ERROR:", uploadError);
      throw error(500, 'Storage error: ' + uploadError.message);
    }

    const { data: { publicUrl } } = supabase.storage
      .from('posts')
      .getPublicUrl(fileName);

    console.log(`SUCCESS: ${publicUrl}`);
    return new Response(JSON.stringify({ url: publicUrl }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('CAUGHT ERROR:', e);
    throw e;
  }
}
