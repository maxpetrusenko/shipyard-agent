/**
 * Bot-loop prevention for webhook processing.
 *
 * Detects and silently skips comments from the bot's own account
 * to prevent infinite feedback loops.
 *
 * Env var:
 *   SHIPYARD_BOT_LOGIN — the GitHub login of the bot account
 *                        (e.g. "shipyard-bot[bot]")
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookSenderInfo {
  login?: string;
  type?: string;
}

export interface BotCheckResult {
  isBot: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Check whether a webhook sender is the bot's own account.
 *
 * Detection criteria (any match triggers):
 * 1. sender.type === 'Bot'
 * 2. sender.login matches SHIPYARD_BOT_LOGIN env var (case-insensitive)
 * 3. sender.login ends with '[bot]' (GitHub App convention)
 */
export function isBotSender(sender: WebhookSenderInfo): BotCheckResult {
  const login = (sender.login ?? '').toLowerCase();
  const type = (sender.type ?? '').toLowerCase();

  // Check sender.type === 'Bot'
  if (type === 'bot') {
    return { isBot: true, reason: `sender.type is "Bot" (login: ${sender.login ?? 'unknown'})` };
  }

  // Check against configured bot login
  const botLogin = (process.env['SHIPYARD_BOT_LOGIN'] ?? '').toLowerCase();
  if (botLogin && login === botLogin) {
    return { isBot: true, reason: `sender.login "${sender.login}" matches SHIPYARD_BOT_LOGIN` };
  }

  // Check [bot] suffix convention
  if (login.endsWith('[bot]')) {
    return { isBot: true, reason: `sender.login "${sender.login}" has [bot] suffix` };
  }

  return { isBot: false };
}
