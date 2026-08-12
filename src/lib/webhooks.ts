import { supabase } from './supabase';

export interface WebhookEndpoint {
  id: string;
  url: string;
  secret: string;
  description?: string;
  active: boolean;
  createdAt: string;
}

export interface WebhookDelivery {
  id: number;
  event: string;
  attempts: number;
  deliveredAt?: string;
  lastStatus?: number;
  lastError?: string;
  createdAt: string;
  inspectionId?: string;
}

/**
 * A shared secret the receiving end uses to verify the signature on the body.
 *
 * Generated here rather than server-side for one reason: whoever is setting the
 * integration up has to copy it into the other system, and a secret they never
 * see is a secret they cannot use.
 */
export function newSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function listEndpoints(): Promise<WebhookEndpoint[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('webhook_endpoints')
    .select('id, url, secret, description, active, created_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: String(row.id),
    url: String(row.url),
    secret: String(row.secret),
    description: row.description ? String(row.description) : undefined,
    active: row.active !== false,
    createdAt: String(row.created_at),
  }));
}

export async function addEndpoint(
  url: string,
  description: string,
): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Webhooks need a backend. This deployment has none.' };
  const { error } = await supabase.from('webhook_endpoints').insert({
    url: url.trim(),
    description: description.trim() || null,
    secret: newSecret(),
  });
  if (error) {
    // The check constraint on the column, said in a way somebody can act on.
    if (error.message.includes('webhook_endpoints_url_is_https')) {
      return { error: 'The URL has to start with https://. Inspection data does not go over http.' };
    }
    return { error: error.message };
  }
  return {};
}

export async function setEndpointActive(id: string, active: boolean): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Webhooks need a backend. This deployment has none.' };
  const { error } = await supabase.from('webhook_endpoints').update({ active }).eq('id', id);
  return error ? { error: error.message } : {};
}

export async function removeEndpoint(id: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Webhooks need a backend. This deployment has none.' };
  const { error } = await supabase.from('webhook_endpoints').delete().eq('id', id);
  return error ? { error: error.message } : {};
}

/** The recent queue, for diagnosing an integration that has stopped working. */
export async function listDeliveries(limit = 20): Promise<WebhookDelivery[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('webhook_deliveries')
    .select('id, event, attempts, delivered_at, last_status, last_error, created_at, payload')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: Number(row.id),
    event: String(row.event),
    attempts: Number(row.attempts ?? 0),
    deliveredAt: row.delivered_at ? String(row.delivered_at) : undefined,
    lastStatus: typeof row.last_status === 'number' ? row.last_status : undefined,
    lastError: row.last_error ? String(row.last_error) : undefined,
    createdAt: String(row.created_at),
    inspectionId: (row.payload as { data?: { inspection_id?: string } } | null)?.data
      ?.inspection_id,
  }));
}
