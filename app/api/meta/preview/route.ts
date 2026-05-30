import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { checkRateLimit } from '@/lib/rate-limit';
import { loadMetaClientContext, loadApprovedAd } from '@/lib/meta-launch-data';
import { uploadAdImage, buildObjectStorySpec, generatePreview, destinationLink, defaultCtaFor } from '@/lib/meta-ads';
import type { Destination } from '@/types';

// POST /api/meta/preview — render a real Meta ad preview (iframe HTML). No credit.
// Body: { clientId, approvalId, headline, primaryText?, cta?, destination, adFormat? }
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const rl = checkRateLimit(`meta-preview:${user.id}`, { max: 30, windowMs: 60_000 });
    if (!rl.ok) return NextResponse.json({ error: 'יותר מדי בקשות, נסה שוב בעוד מעט' }, { status: 429 });

    const body = await req.json();
    const { clientId, approvalId, headline, primaryText, cta, adFormat } = body;
    const destination = body.destination as Destination;
    if (!clientId || !approvalId || !destination?.type) {
      return NextResponse.json({ error: 'Missing clientId, approvalId or destination' }, { status: 400 });
    }

    const [ctx, ad] = await Promise.all([
      loadMetaClientContext(supabase, clientId, user.id),
      loadApprovedAd(supabase, approvalId, user.id),
    ]);
    if (!ad.imageUrl) return NextResponse.json({ error: 'למודעה המאושרת אין תמונה' }, { status: 400 });

    const { imageHash } = await uploadAdImage(ctx.token, ctx.adAccountId, ad.imageUrl);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://admaster-three.vercel.app';
    const link = destinationLink(destination, appUrl);

    const spec = buildObjectStorySpec({
      pageId:      ctx.pageId,
      headline:    headline || ad.title || '',
      primaryText: primaryText || ad.text,
      destination,
      imageHash,
      link,
      cta:         cta || defaultCtaFor(destination.type),
    });

    const { previewHtml } = await generatePreview(ctx.token, ctx.adAccountId, spec, adFormat);
    return NextResponse.json({ previewHtml, link });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
