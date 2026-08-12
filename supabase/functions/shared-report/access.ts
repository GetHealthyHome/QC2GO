/**
 * Whether a share token may be used, decided as a pure function.
 *
 * An anonymous caller reaches this: no session, no company, nothing behind it
 * but the token in their URL. Every reason to refuse lives here so that each
 * one can be asserted rather than inferred from a screenshot of a working link.
 */

export interface ShareRow {
  expires_at: string;
  revoked_at: string | null;
  passcode_hash: string | null;
}

export type AccessDecision =
  | { ok: true }
  | { ok: false; status: number; message: string };

/**
 * Deliberately the same message for "no such token" and "expired token".
 *
 * Telling the difference would let somebody with a list of guesses learn which
 * ones were once real, and there is nothing a legitimate reader does with the
 * distinction — either way the answer is "ask them to send a new link".
 */
const GONE = {
  ok: false as const,
  status: 404,
  message: 'This link is not valid any more. Ask for a new one.',
};

export function decideAccess(
  share: ShareRow | null,
  suppliedPasscodeHash: string | null,
  now: Date,
): AccessDecision {
  if (!share) return GONE;
  if (share.revoked_at) return GONE;
  if (new Date(share.expires_at).getTime() <= now.getTime()) return GONE;

  if (share.passcode_hash) {
    if (!suppliedPasscodeHash) {
      return { ok: false, status: 401, message: 'This report needs a passcode.' };
    }
    if (!timingSafeEqual(share.passcode_hash, suppliedPasscodeHash)) {
      return { ok: false, status: 401, message: 'That passcode is not right.' };
    }
  }

  return { ok: true };
}

/**
 * Whether the record behind a valid token is in a state fit to be read.
 *
 * A share is created from a signed report, but a signed report can be reopened
 * — and while it is open it is a working draft: half-corrected answers, a score
 * that has been cleared, photos being replaced. A link handed to a homeowner
 * last week must not start showing them that. It goes dark until the record is
 * signed again, at which point the same link works.
 *
 * The token holder already knows the record exists, so saying why is no
 * disclosure and saves them chasing a link that is fine.
 */
export function decideRecord(
  inspection: { status?: unknown; org_id?: unknown } | null,
  shareOrgId: unknown,
): AccessDecision {
  if (!inspection) return { ok: false, status: 404, message: 'That report is no longer available.' };
  // Belt and braces: this function runs with the service key, so nothing
  // underneath it would notice a share pointed at another company's record.
  if (inspection.org_id !== shareOrgId) return GONE;
  if (inspection.status !== 'completed') {
    return {
      ok: false,
      status: 409,
      message: 'This report is being updated. It will be readable again once it is signed off.',
    };
  }
  return { ok: true };
}

/**
 * Constant-time comparison of two hex digests.
 *
 * `===` on strings returns as soon as it finds a difference, and the time that
 * takes is measurable over enough requests. It is a small leak against a
 * four-digit passcode and a free one to close.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

/**
 * What an anonymous reader is allowed to see.
 *
 * Allow-list rather than deleting fields from the record: a column added later
 * is invisible here by default, which is the direction this has to fail in. The
 * first version of anything like this leaks `created_by` and the internal ids of
 * everything the record touches.
 */
export function publicReport(input: {
  inspection: Record<string, unknown>;
  customer: Record<string, unknown> | null;
  organization: Record<string, unknown> | null;
  photos: Array<Record<string, unknown>>;
}) {
  const { inspection, customer, organization, photos } = input;
  return {
    organization: {
      name: organization?.name ?? '',
      logo: organization?.logo ?? null,
    },
    customer: {
      customerName: customer?.customer_name ?? '',
      address: customer?.address ?? '',
    },
    inspection: {
      id: inspection.id,
      visitType: inspection.visit_type,
      visitDate: inspection.visit_date,
      status: inspection.status,
      completedAt: inspection.completed_at,
      info: inspection.info,
      responses: inspection.responses,
      sectionInstances: inspection.section_instances,
      snapshot: inspection.snapshot,
      summaryNotes: inspection.summary_notes,
      inspectorSignature: inspection.inspector_sig,
      customerSignature: inspection.customer_sig,
      overallScore: inspection.overall_score,
      passFailStatus: inspection.pass_fail_status,
      totalDeficiencies: inspection.total_deficiencies,
      // Deliberately absent: created_by, org_id, template_id, reopenings.
      // Who reopened a record and why is the company's business, not the
      // recipient's.
    },
    photos: photos.map((photo) => ({
      id: photo.id,
      questionId: photo.question_id,
      url: photo.url,
      annotations: photo.annotations ?? [],
    })),
  };
}
