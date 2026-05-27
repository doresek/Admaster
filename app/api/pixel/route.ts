import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getDecryptedMetaToken } from '@/lib/meta';

const GRAPH = 'https://graph.facebook.com/v19.0';

// GET /api/pixel?clientId=xxx — list pixels
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const clientId = req.nextUrl.searchParams.get('clientId');
  const query = supabase.from('pixels').select('*').eq('user_id', user.id);
  if (clientId) query.eq('client_id', clientId);

  const { data } = await query.order('created_at', { ascending: false });
  return NextResponse.json(data ?? []);
}

// POST /api/pixel — create pixel
export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { clientId, name, websiteUrl } = await req.json();

  const { data: client } = await supabase
    .from('meta_clients')
    .select('selected_ad_account_id')
    .eq('id', clientId).eq('user_id', user.id).single();

  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const token = await getDecryptedMetaToken(supabase, clientId, user.id);
  if (!token) return NextResponse.json({ error: 'Client token missing' }, { status: 404 });

  let metaPixelId = null;
  let pixelCode = null;

  // Create pixel in Meta
  try {
    const res = await fetch(`${GRAPH}/${client.selected_ad_account_id}/adspixels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ access_token: token, name }),
    });
    const data = await res.json();
    if (!data.error) {
      metaPixelId = data.id;

      // Get pixel code
      const codeRes = await fetch(`${GRAPH}/${data.id}?fields=code&access_token=${encodeURIComponent(token)}`);
      const codeData = await codeRes.json();
      pixelCode = codeData.code;
    }
  } catch (_) {}

  // Generate pixel code manually if Meta didn't return one
  if (!pixelCode && metaPixelId) {
    pixelCode = generatePixelCode(metaPixelId);
  }

  // Save to DB
  const { data: pixel } = await supabase.from('pixels').insert({
    user_id: user.id, client_id: clientId,
    name, meta_pixel_id: metaPixelId,
    pixel_code: pixelCode, website_url: websiteUrl,
  }).select().single();

  return NextResponse.json(pixel);
}

function generatePixelCode(pixelId: string) {
  return `<!-- Meta Pixel Code -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${pixelId}');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1"
/></noscript>
<!-- End Meta Pixel Code -->`;
}
