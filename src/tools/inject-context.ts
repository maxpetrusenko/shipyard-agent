/**
 * inject_context tool: add context to the current run mid-loop.
 */

export interface InjectContextParams {
  label: string;
  content: string;
}

export interface InjectContextResult {
  success: boolean;
  message: string;
}

export function injectContext(
  params: InjectContextParams,
): InjectContextResult {
  // This is handled by the server's context store, not directly by the tool.
  // The tool exists so the LLM can request context injection,
  // which gets routed through the InstructionLoop.
  return {
    success: true,
    message: `Context "${params.label}" noted. It will be available in the next turn.`,
  };
}
