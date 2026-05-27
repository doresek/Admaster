import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { PLAN_CONFIG, type Plan } from '@/types';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-04-10' });

// POST /api/credits
//  body: { plan } — subscription checkout
//  body: { topup: { credits, amount } } — one-time credit purchase
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json() as { plan?: Plan; topup?: { credits: number; amount: number } };

    // ─────────────── ONE-TIME TOP-UP ───────────────
    if (body.topup) {
      const { credits, amount } = body.topup;
      if (!credits || credits <= 0 || !amount || amount <= 0) {
        return NextResponse.json({ error: 'Invalid top-up values' }, { status: 400 });
      }

      // Record pending top-up in DB
      const { data: topup, error } = await supabase.from('credit_topups').insert({
        user_id: user.id, credits, amount_ils: amount, status: 'pending',
      }).select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        line_items: [{
          price_data: {
            currency: 'ils',
            product_data: { name: `${credits.toLocaleString()} קרדיטים — AdMaster Pro` },
            unit_amount: amount * 100,
          },
          quantity: 1,
        }],
        success_url: `${process.env.NEXT_PUBLIC_APP_URL}/credits?topup=success`,
        cancel_url:  `${process.env.NEXT_PUBLIC_APP_URL}/credits?topup=cancelled`,
        metadata: { userId: user.id, topupId: topup.id, type: 'topup', credits: String(credits) },
        customer_email: user.email,
      });

      // Store the stripe session id so the webhook can match
      await supabase.from('credit_topups')
        .update({ stripe_session: session.id })
        .eq('id', topup.id);

      return NextResponse.json({ url: session.url });
    }

    // ─────────────── SUBSCRIPTION ───────────────
    const { plan } = body;
    if (!plan) return NextResponse.json({ error: 'Missing plan or topup' }, { status: 400 });
    const planConfig = PLAN_CONFIG[plan];
    if (!planConfig || planConfig.price === 0) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }

    const STRIPE_PRICE_IDS: Record<string, string> = {
      starter: process.env.STRIPE_PRICE_STARTER ?? 'price_xxx',
      pro:     process.env.STRIPE_PRICE_PRO     ?? 'price_xxx',
      agency:  process.env.STRIPE_PRICE_AGENCY  ?? 'price_xxx',
    };

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: STRIPE_PRICE_IDS[plan], quantity: 1 }],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/credits?success=true`,
      cancel_url:  `${process.env.NEXT_PUBLIC_APP_URL}/credits?cancelled=true`,
      metadata: { userId: user.id, plan, type: 'subscription' },
      customer_email: user.email,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// GET /api/credits — returns the current user's credit balance and plan
export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users').select('credits, plan').eq('id', user.id).single();

  return NextResponse.json({ credits: profile?.credits ?? 0, plan: profile?.plan ?? 'free' });
}
