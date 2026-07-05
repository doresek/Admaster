import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { hasActiveCustomer } from '@/lib/billing';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-04-10' });

// POST /api/billing/portal
// Opens the Stripe Customer Portal so users can self-serve cancel / downgrade.
export async function POST() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Resolve the Stripe customer by email (we don't store a stripe_customer_id).
    const customers = await stripe.customers.list({ email: user.email, limit: 1 });
    if (!hasActiveCustomer(customers)) {
      return NextResponse.json({ error: 'לא נמצא מנוי פעיל' }, { status: 400 });
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: customers.data[0].id,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/credits`,
    });

    return NextResponse.json({ url: portal.url });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
