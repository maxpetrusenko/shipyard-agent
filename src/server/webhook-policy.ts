/**
 * Command authorization policy for webhook comment senders.
 *
 * Controls who is allowed to trigger /shipyard commands via GitHub webhook
 * comments. Supports both author-based allowlists and role-based gates.
 *
 * Env vars:
 *   SHIPYARD_WEBHOOK_ALLOWED_AUTHORS  — comma-separated GitHub logins
 *   SHIPYARD_WEBHOOK_ALLOWED_ROLES    — comma-separated association roles
 *                                       (e.g. "OWNER,MEMBER,COLLABORATOR")
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookSender {
  login?: string;
  type?: string;
  association?: string; // author_association from GitHub payload
}

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
  code?: string;
}

// ---------------------------------------------------------------------------
// Policy evaluation
// ---------------------------------------------------------------------------

/**
 * Check whether a webhook sender is authorized to trigger commands.
 *
 * Returns `{ allowed: true }` when no restrictions are configured
 * (both env vars unset) or the sender passes at least one gate.
 */
export function evaluateWebhookPolicy(sender: WebhookSender): PolicyResult {
  const allowedAuthors = parseCommaSeparated(
    process.env['SHIPYARD_WEBHOOK_ALLOWED_AUTHORS'],
  );
  const allowedRoles = parseCommaSeparated(
    process.env['SHIPYARD_WEBHOOK_ALLOWED_ROLES'],
  );

  // No restrictions configured — allow all
  if (allowedAuthors.length === 0 && allowedRoles.length === 0) {
    return { allowed: true };
  }

  const login = (sender.login ?? '').toLowerCase();
  const association = (sender.association ?? '').toUpperCase();

  // Author allowlist check
  if (allowedAuthors.length > 0 && login) {
    if (allowedAuthors.includes(login)) {
      return { allowed: true };
    }
  }

  // Role gate check
  if (allowedRoles.length > 0 && association) {
    if (allowedRoles.includes(association)) {
      return { allowed: true };
    }
  }

  // Neither gate passed
  return {
    allowed: false,
    reason: `Sender "${sender.login ?? 'unknown'}" with association "${sender.association ?? 'NONE'}" is not authorized`,
    code: 'WEBHOOK_SENDER_DENIED',
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseCommaSeparated(value: string | undefined): string[] {
  if (!value || !value.trim()) return [];
  return value
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
