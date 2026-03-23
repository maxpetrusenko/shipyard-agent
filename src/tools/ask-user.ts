/**
 * ask_user tool: pause the graph and request user input.
 *
 * Uses LangGraph interrupt() for HITL pause/resume.
 * The server resumes the graph when the user responds via WebSocket.
 */

import { interrupt } from '@langchain/langgraph';

export interface AskUserParams {
  question: string;
}

export interface AskUserResult {
  answer: string;
}

/**
 * Pause execution and wait for user input.
 *
 * This calls LangGraph's interrupt() which pauses the graph.
 * The server must resume the graph with the user's answer via
 * graph.invoke(null, { configurable: { thread_id }, resumeValue: answer })
 */
export function askUser(params: AskUserParams): AskUserResult {
  const answer = interrupt(params.question) as string;
  return { answer };
}
