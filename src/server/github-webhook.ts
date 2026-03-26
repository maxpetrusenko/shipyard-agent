export interface ParsedShipyardCommand {
  instruction: string | null;
  prefixRequired: boolean;
  prefix: string;
  runMode: 'chat' | 'code';
  confirmPlan: boolean;
  threadKindHint: 'ask' | 'plan' | 'agent';
}

export interface GithubConversationRef {
  key: string;
  kind: 'issue' | 'review';
  repository: string;
  installationId: number | null;
  issueNumber?: number;
  pullRequestNumber?: number;
  commentId?: number;
  rootCommentId?: number;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function resolveGithubWebhookSecret(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const secret =
    env['SHIPYARD_GITHUB_WEBHOOK_SECRET']?.trim() ||
    env['GITHUB_WEBHOOK_SECRET']?.trim();
  return secret || undefined;
}

export function parseShipyardCommand(body: string): ParsedShipyardCommand {
  const prefix = (process.env['SHIPYARD_COMMAND_PREFIX'] ?? '/shipyard').trim();
  const regex = new RegExp(`${escapeRegex(prefix)}\\s+(.+)`, 'i');
  const match = body.match(regex);
  if (!match) {
    return {
      instruction: null,
      prefixRequired: true,
      prefix,
      runMode: 'code',
      confirmPlan: false,
      threadKindHint: 'agent',
    };
  }

  const raw = match[1]!.trim();
  const [verb = '', ...rest] = raw.split(/\s+/);
  const normalizedVerb = verb.toLowerCase();
  const remainder = rest.join(' ').trim();

  if (normalizedVerb === 'ask') {
    return {
      instruction: remainder || raw,
      prefixRequired: true,
      prefix,
      runMode: 'chat',
      confirmPlan: false,
      threadKindHint: 'ask',
    };
  }

  if (normalizedVerb === 'plan') {
    return {
      instruction: remainder || raw,
      prefixRequired: true,
      prefix,
      runMode: 'code',
      confirmPlan: true,
      threadKindHint: 'plan',
    };
  }

  if (normalizedVerb === 'run' || normalizedVerb === 'agent') {
    return {
      instruction: remainder || raw,
      prefixRequired: true,
      prefix,
      runMode: 'code',
      confirmPlan: false,
      threadKindHint: 'agent',
    };
  }

  return {
    instruction: raw,
    prefixRequired: true,
    prefix,
    runMode: 'code',
    confirmPlan: false,
    threadKindHint: 'agent',
  };
}

export function extractCommandFromComment(body: string): {
  instruction: string | null;
  prefixRequired: boolean;
  prefix: string;
} {
  const parsed = parseShipyardCommand(body);
  return {
    instruction: parsed.instruction,
    prefixRequired: parsed.prefixRequired,
    prefix: parsed.prefix,
  };
}

export function buildGithubConversationRef(
  eventType: string,
  payload: Record<string, unknown>,
): GithubConversationRef | null {
  const repository = readObject(payload['repository']);
  const repoFullName =
    typeof repository?.['full_name'] === 'string'
      ? repository['full_name'].trim()
      : '';
  if (!repoFullName) return null;

  const installation = readObject(payload['installation']);
  const installationId = readNumber(installation?.['id']);

  if (eventType === 'issue_comment') {
    const issue = readObject(payload['issue']);
    const comment = readObject(payload['comment']);
    const issueNumber = readNumber(issue?.['number']);
    if (issueNumber === null) return null;
    return {
      key: `issue:${installationId ?? 'na'}:${repoFullName}:${issueNumber}`,
      kind: 'issue',
      repository: repoFullName,
      installationId,
      issueNumber,
      commentId: readNumber(comment?.['id']) ?? undefined,
    };
  }

  if (eventType === 'pull_request_review_comment') {
    const pullRequest = readObject(payload['pull_request']);
    const comment = readObject(payload['comment']);
    const pullRequestNumber = readNumber(pullRequest?.['number']);
    const commentId = readNumber(comment?.['id']);
    if (pullRequestNumber === null || commentId === null) return null;
    const rootCommentId = readNumber(comment?.['in_reply_to_id']) ?? commentId;
    return {
      key: `review:${installationId ?? 'na'}:${repoFullName}:${pullRequestNumber}:${rootCommentId}`,
      kind: 'review',
      repository: repoFullName,
      installationId,
      pullRequestNumber,
      commentId,
      rootCommentId,
    };
  }

  return null;
}
