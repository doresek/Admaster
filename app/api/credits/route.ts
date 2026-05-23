import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { PLAN_CONFIG, type Plan } from '@/types';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

// POST /api/credits/checkout — create Stripe checkout session
export async function POST(req: NextRequest) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { plan } = await req.json() as { plan: Plan };
    const planConfig = PLAN_CONFIG[plan];
    if (!planConfig || planConfig.price === 0) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }

    // Stripe price IDs — create these in Stripe dashboard
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
      metadata: { userId: user.id, plan },
      customer_email: user.email,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
