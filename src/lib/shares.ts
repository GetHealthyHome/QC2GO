import { supabase } from './supabase';

export interface ReportShare {
  id: string;
  inspectionId: string;
  recipient?: string;
  expiresAt: string;
  revokedAt?: string;
  viewCount: number;
  lastViewedAt?: string;
  createdAt: string;
}

/**
 * The token, and the only moment it exists in readable form.
 *
 * Only a hash reaches the database, so a link cannot be recovered later — it is
 * shown once and replaced if lost. That is the right way round: a lost link
 * costs two taps, and a table of live tokens costs every report in it.
 */
function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function shareUrl(token: string): string {
  return `${window.location.origin}${window.location.pathname}#/shared/${token}`;
}

export async function createShare(
  inspectionId: string,
  options: { days: number; recipient?: string; passcode?: string },
): Promise<{ url?: string; error?: string }> {
  if (!supabase) return { error: 'Sharing needs a backend. This deployment has none.' };

  const { data: session } = await supabase.auth.getUser();
  if (!session.user) return { error: 'Sign in to share a report.' };

  const token = newToken();
  const expiresAt = new Date(Date.now() + options.days * 86_400_000).toISOString();

  const { error } = await supabase.from('report_shares').insert({
    inspection_id: inspectionId,
    token_hash: await sha256(token),
    passcode_hash: options.passcode ? await sha256(options.passcode) : null,
    recipient: options.recipient?.trim() || null,
    expires_at: expiresAt,
    created_by: session.user.id,
  });

  if (error) return { error: error.message };
  return { url: shareUrl(token) };
}

export async function listShares(inspectionId: string): Promise<ReportShare[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('report_shares')
    .select('id, inspection_id, recipient, expires_at, revoked_at, view_count, last_viewed_at, created_at')
    .eq('inspection_id', inspectionId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    id: String(row.id),
    inspectionId: String(row.inspection_id),
    recipient: row.recipient ? String(row.recipient) : undefined,
    expiresAt: String(row.expires_at),
    revokedAt: row.revoked_at ? String(row.revoked_at) : undefined,
    viewCount: Number(row.view_count ?? 0),
    lastViewedAt: row.last_viewed_at ? String(row.last_viewed_at) : undefined,
    createdAt: String(row.created_at),
  }));
}

/** Anybody in the company may revoke: a link sent to the wrong address is an emergency. */
export async function revokeShare(id: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Sharing needs a backend. This deployment has none.' };
  const { error } = await supabase
    .from('report_shares')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id);
  return error ? { error: error.message } : {};
}

export interface SharedReport {
  organization: { name: string; logo?: string | null };
  customer: { customerName: string; address: string };
  inspection: Record<string, unknown>;
  photos: Array<{ id: string; questionId: string; url: string; annotations?: unknown[] }>;
}

/**
 * Read a shared report. No session involved — the token is the whole credential,
 * and the function on the other end decides what a holder of it may see.
 */
export async function fetchSharedReport(
  token: string,
  passcode?: string,
): Promise<{
  report?: SharedReport;
  error?: string;
  needsPasscode?: boolean;
  /**
   * The link is fine and the report is not — it is being amended, and the same
   * link works again once it is signed off. Worth telling apart from a dead
   * link, because the two ask different things of the reader: wait, or go back
   * and ask for a new one.
   */
  pending?: boolean;
}> {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  if (!url) return { error: 'Sharing is not configured on this deployment.' };

  try {
    const response = await fetch(`${url}/functions/v1/shared-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, passcode }),
    });
    const body = await response.json();
    if (!response.ok) {
      return {
        error: body?.error ?? 'This report could not be opened.',
        needsPasscode: body?.needsPasscode,
        pending: response.status === 409,
      };
    }
    return { report: body as SharedReport };
  } catch {
    return { error: 'Could not reach the server. Check your connection and try again.' };
  }
}
