import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createAdminClient } from '@/lib/supabase/server';
import { PLAN_CONFIG, type Plan } from '@/types';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });

export async function POST(req: NextRequest) {
  const body = await req.text();
  const sig  = req.headers.get('stripe-signature')!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    return NextResponse.json({ error: `Webhook error: ${err.message}` }, { status: 400 });
  }

  const admin = createAdminClient();

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const { userId, plan } = session.metadata as { userId: string; plan: Plan };
      const planConfig = PLAN_CONFIG[plan];

      await admin
        .from('users')
        .update({
          plan,
          credits: planConfig.credits, // reset to plan credits on new subscription
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId);
      break;
    }

    case 'invoice.paid': {
      // Monthly renewal — add credits
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;

      // Find user by Stripe customer ID (you'd store this on subscription)
      // For simplicity, metadata approach:
      const sub = await stripe.subscriptions.retrieve(invoice.subscription as string);
      const { userId, plan } = sub.metadata as { userId: string; plan: Plan };
      if (userId && plan) {
        const planConfig = PLAN_CONFIG[plan];
        await admin
          .from('users')
          .update({ credits: planConfig.credits, updated_at: new Date().toISOString() })
          .eq('id', userId);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as Stripe.Subscription;
      const { userId } = sub.metadata as { userId: string };
      if (userId) {
        await admin
          .from('users')
          .update({ plan: 'free', updated_at: new Date().toISOString() })
          .eq('id', userId);
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
