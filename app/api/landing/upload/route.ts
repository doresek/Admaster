import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// POST /api/landing/upload
// Body: multipart/form-data with `file`
// Returns: { url: string } — public URL of uploaded image in `landing-uploads` bucket.
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'Missing file' }, { status: 400 });
  }

  // Validate file size (5MB max — bucket also enforces)
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: 'הקובץ חורג מ-5MB' }, { status: 400 });
  }

  // Validate MIME type
  const mime = file.type || 'image/jpeg';
  if (!/^image\/(png|jpe?g|webp|gif)$/i.test(mime)) {
    return NextResponse.json({ error: 'סוג קובץ לא נתמך — png/jpg/webp/gif בלבד' }, { status: 400 });
  }

  const ext = mime.split('/')[1].replace('jpeg', 'jpg');
  const filename = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const { data, error } = await supabase.storage
    .from('landing-uploads')
    .upload(filename, file, { contentType: mime, upsert: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: { publicUrl } } = supabase.storage
    .from('landing-uploads')
    .getPublicUrl(data.path);

  return NextResponse.json({ url: publicUrl, path: data.path });
}
