import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import Anthropic from '@anthropic-ai/sdk';

const GRAPH  = 'https://graph.facebook.com/v19.0';
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

// GET /api/competitor?query=תפילין&country=IL&limit=20
export async function GET(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const query   = req.nextUrl.searchParams.get('query') || '';
  const country = req.nextUrl.searchParams.get('country') || 'IL';
  const limit   = req.nextUrl.searchParams.get('limit') || '20';
  const analyze = req.nextUrl.searchParams.get('analyze') === 'true';

  try {
    // Meta Ad Library API — public, no token needed
    const fields = 'id,ad_creative_bodies,ad_creative_link_captions,ad_creative_link_descriptions,ad_creative_link_titles,ad_delivery_start_time,ad_delivery_stop_time,ad_snapshot_url,page_name,page_id,impressions,spend,currency';
    const url = `${GRAPH}/ads_archive?` + new URLSearchParams({
      search_terms: query,
      ad_reached_countries: country,
      ad_type: 'ALL',
      ad_active_status: 'ACTIVE',
      fields,
      limit,
      access_token: process.env.META_APP_TOKEN || '',
    });

    const res  = await fetch(url);
    const data = await res.json();

    if (data.error) {
      // Fallback: return mock data for development
      return NextResponse.json({ ads: getMockAds(query), mock: true });
    }

    const ads = data.data ?? [];

    // AI analysis if requested
    let analysis = null;
    if (analyze && ads.length > 0) {
      const topAds = ads.slice(0, 5).map((ad: any) => ({
        page: ad.page_name,
        body: ad.ad_creative_bodies?.[0]?.substring(0, 200),
        title: ad.ad_creative_link_titles?.[0],
        caption: ad.ad_creative_link_captions?.[0],
      }));

      const msg = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: `נתח ${topAds.length} מודעות של מתחרים בתחום "${query}" בישראל.
מודעות:
${JSON.stringify(topAds, null, 2)}

ספק:
1. מה הנושאים הנפוצים
2. איזה hooks חוזרים
3. מה הצעות הערך
4. מה חסר / הזדמנויות
5. 3 רעיונות למודעה שתבלוט מעל כולם`,
        }],
      });

      analysis = msg.content[0].type === 'text' ? msg.content[0].text : null;
    }

    return NextResponse.json({ ads, analysis });
  } catch (err: any) {
    return NextResponse.json({ ads: getMockAds(query), mock: true, error: err.message });
  }
}

function getMockAds(query: string) {
  return [
    { id:'1', page_name:'תפילין מהדרין', ad_creative_bodies:['✡️ תפילין מהודרות לבר מצווה — מחיר מיוחד! 15% הנחה לחודש זה בלבד'], ad_delivery_start_time:'2024-01-01', impressions:{lower_bound:'1000',upper_bound:'5000'} },
    { id:'2', page_name:'יודאיקה שופ', ad_creative_bodies:['🎁 מתנה מושלמת לבר מצווה — סט תפילין + תיק עור במחיר מדהים'], ad_delivery_start_time:'2024-01-15', impressions:{lower_bound:'5000',upper_bound:'10000'} },
    { id:'3', page_name:'סת"ם ירושלים', ad_creative_bodies:['כשרות מהדרין · בדיקת מחשב · משלוח חינם · 30 שנות ניסיון'], ad_delivery_start_time:'2024-02-01', impressions:{lower_bound:'2000',upper_bound:'7000'} },
  ];
}
