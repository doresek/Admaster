import type { SupabaseClient } from '@supabase/supabase-js';
import type { Client, ClientStrategy, MetaClient } from '@/types';

// ════════════════════════════════════════════
// lib/clients — the single read/write path for the clean client model (v2).
//
// `clients` is the business-identity record ONLY: name + contact fields. It
// never touches Meta — the optional Meta asset lives on `meta_connections`
// (resolve via lib/meta-connections.ts `getActiveConnection`). Per-client
// strategy (business analysis + avatar) lives on `client_strategy`.
//
// RLS: clients.owner = owner_user_id; client_strategy.owner = owner_user_id.
// Every read/write here is also explicitly scoped to owner_user_id so the
// layer is correct even against a service-role client that bypasses RLS.
// ════════════════════════════════════════════

export type { Client, ClientStrategy } from '@/types';

// Columns selected for every Client read/write. Excludes nothing sensitive —
// `connect_token` is an opaque magic-link token, not a credential.
const CLIENT_COLUMNS =
  'id, owner_user_id, name, email, phone, company, notes, connect_token, connect_expires_at, connect_consumed_at, created_at, updated_at';

const STRATEGY_COLUMNS =
  'id, client_id, owner_user_id, business_analysis, avatar, core_generated_at, updated_at';

// Whether a client may be created from a given name input. The /clients
// "create" button is disabled until this returns true (name is required).
export function canCreateClient(name: string): boolean {
  return name.trim().length > 0;
}

export interface CreateClientInput {
  ownerUserId: string;
  name:        string;
  email?:      string | null;
  phone?:      string | null;
  company?:    string | null;
  notes?:      string | null;
}

// Insert a new client identity. `name` is required; everything else is
// optional contact metadata. NEVER calls Meta/Graph or writes any credential.
export async function createClient(
  supabase: SupabaseClient,
  input: CreateClientInput,
): Promise<Client> {
  const name = input.name?.trim();
  if (!name) throw new Error('Missing name');

  const { data, error } = await supabase
    .from('clients')
    .insert({
      owner_user_id: input.ownerUserId,
      name,
      email:   input.email   ?? null,
      phone:   input.phone   ?? null,
      company: input.company ?? null,
      notes:   input.notes   ?? null,
    })
    .select(CLIENT_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return data as Client;
}

// Fetch a single client owned by the user. Returns null when not found.
export async function getClient(
  supabase: SupabaseClient,
  id: string,
  ownerUserId: string,
): Promise<Client | null> {
  const { data, error } = await supabase
    .from('clients')
    .select(CLIENT_COLUMNS)
    .eq('id', id)
    .eq('owner_user_id', ownerUserId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as Client) ?? null;
}

// List all clients owned by the user, newest first.
export async function listClients(
  supabase: SupabaseClient,
  ownerUserId: string,
): Promise<Client[]> {
  const { data, error } = await supabase
    .from('clients')
    .select(CLIENT_COLUMNS)
    .eq('owner_user_id', ownerUserId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data as Client[]) ?? [];
}

export type UpdateClientInput = Partial<
  Pick<Client, 'name' | 'email' | 'phone' | 'company' | 'notes'>
>;

// Update mutable identity fields. Scoped to the owner; touches updated_at.
export async function updateClient(
  supabase: SupabaseClient,
  id: string,
  ownerUserId: string,
  patch: UpdateClientInput,
): Promise<Client> {
  const { data, error } = await supabase
    .from('clients')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('owner_user_id', ownerUserId)
    .select(CLIENT_COLUMNS)
    .single();

  if (error) throw new Error(error.message);
  return data as Client;
}

// Adapt a v2 `clients` identity row to the legacy `MetaClient` shape that many
// dashboard surfaces still render (dropdowns/chips keyed on id+name+emoji).
// The clean model keeps NO Meta assets, emoji, or activity counts on the
// identity record, so those are filled with safe placeholders:
//   • emoji → '🏢' (clients has no emoji column)
//   • pages / ad_accounts → [] and selected_* → null (assets live on
//     meta_connections now; resolve real values via getActiveConnection)
//   • posts_published / campaigns_created → 0 (TODO: compute from content later)
// NEVER trust these placeholders for anything Meta-related.
export function clientToMetaClient(
  c: { id: string; name: string; owner_user_id?: string; created_at?: string; updated_at?: string },
): MetaClient {
  return {
    id:                     c.id,
    user_id:                c.owner_user_id ?? '',
    name:                   c.name,
    industry:               null,
    emoji:                  '🏢',
    token:                  '',
    meta_user_id:           null,
    meta_user_name:         null,
    pages:                  [],
    ad_accounts:            [],
    selected_page_id:       null,
    selected_ad_account_id: null,
    status:                 'connected',
    posts_published:        0,
    campaigns_created:      0,
    connected_at:           c.created_at ?? '',
    updated_at:             c.updated_at ?? '',
  };
}

// Read the strategy core for a client. Returns null when none generated yet.
export async function getClientStrategy(
  supabase: SupabaseClient,
  clientId: string,
): Promise<ClientStrategy | null> {
  const { data, error } = await supabase
    .from('client_strategy')
    .select(STRATEGY_COLUMNS)
    .eq('client_id', clientId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data as ClientStrategy) ?? null;
}
