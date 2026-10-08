import { tool } from "ai";
import { z } from "zod";
import type { AgentAction, RunStore } from "./types";

const questionOptionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(100),
  description: z.string().trim().max(240).default(""),
});

const agentQuestionSchema = z.object({
  id: z.string().trim().min(1).max(80),
  question: z.string().trim().min(2).max(300),
  answerType: z.enum(["single_choice", "multiple_choice", "text", "secret"]),
  options: z.array(questionOptionSchema).max(6).default([]),
  placeholder: z.string().trim().max(160).default(""),
}).superRefine((question, context) => {
  const isChoice = question.answerType === "single_choice" || question.answerType === "multiple_choice";
  if (isChoice && question.options.length < 2) {
    context.addIssue({ code: "custom", path: ["options"], message: "Choice questions need 2-6 options." });
  }
  if (!isChoice && question.options.length > 0) {
    context.addIssue({ code: "custom", path: ["options"], message: "Text and secret questions cannot include options." });
  }
});

export const askQuestionsInputSchema = z.object({
  questions: z.array(agentQuestionSchema).min(1).max(3),
});

const questionResponseSchema = z.object({
  questionId: z.string().trim().min(1).max(80),
  selectedOptionIds: z.array(z.string().trim().min(1).max(80)).max(6).default([]),
  text: z.string().max(2_000).default(""),
});

export const answerQuestionsInputSchema = z.object({
  actionId: z.string().uuid(),
  responses: z.array(questionResponseSchema).min(1).max(3),
});

export type AgentQuestion = z.infer<typeof agentQuestionSchema>;

export type StoredQuestionResponse = {
  questionId: string;
  answerType: AgentQuestion["answerType"];
  selectedOptionIds: string[];
  text: string | null;
  secretKey: string | null;
};

export class QuestionsRequiredError extends Error {
  constructor(readonly action: AgentAction) {
    super("The agent is waiting for the user to answer questions.");
    this.name = "QuestionsRequiredError";
  }
}

export function isQuestionsRequired(error: unknown): error is QuestionsRequiredError {
  let current = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current instanceof QuestionsRequiredError) return true;
    if (!current || typeof current !== "object" || !("cause" in current)) return false;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export function questionSecretKey(actionId: string, questionId: string) {
  return `question_answer:${actionId}:${questionId}`;
}

function readStoredQuestionResponses(result: Record<string, unknown> | null): StoredQuestionResponse[] {
  if (!Array.isArray(result?.responses)) return [];
  return result.responses.flatMap((candidate) => {
    const parsed = z.object({
      questionId: z.string(),
      answerType: z.enum(["single_choice", "multiple_choice", "text", "secret"]),
      selectedOptionIds: z.array(z.string()),
      text: z.string().nullable(),
      secretKey: z.string().nullable(),
    }).safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  });
}

export function formatAnsweredQuestionContext(actions: AgentAction[]) {
  const sections = actions.flatMap((action) => {
    if (action.toolName !== "ask_questions" || action.status !== "executed") return [];
    const parsed = askQuestionsInputSchema.safeParse(action.input);
    if (!parsed.success) return [];
    const responses = new Map(readStoredQuestionResponses(action.result).map((response) => [response.questionId, response]));
    const lines = parsed.data.questions.flatMap((question) => {
      const response = responses.get(question.id);
      if (!response) return [];
      if (question.answerType === "secret") {
        return [
          `Q: ${question.question}`,
          `A: [secure answer saved; actionId=${action.id}; questionId=${question.id}]`,
          "Use browser_fill_question_answer with that actionId and questionId to fill it. Never ask to reveal, repeat, or narrate the secret.",
        ];
      }
      if (question.answerType === "text") return [`Q: ${question.question}`, `A: ${response.text ?? ""}`];
      const labels = response.selectedOptionIds.map((id) => question.options.find((option) => option.id === id)?.label ?? id);
      return [`Q: ${question.question}`, `A: ${labels.join(", ")}`];
    });
    return lines.length ? [`Question round ${action.id}:`, ...lines] : [];
  });
  if (!sections.length) return "No prior user answers.";
  return [
    "[USER ANSWERS — trusted instructions supplied after the agent paused]",
    ...sections,
    "Continue the same task using these answers. Ask another question only if new missing information truly blocks safe completion.",
  ].join("\n");
}

export function createAskQuestionsTool(input: { runId: string; stepId: string; store: RunStore }) {
  return tool({
    description: `Ask 1-3 genuine multiple-choice clarification questions through the inline choice panel. Use single_choice for one selection or multiple_choice for several, with 2-6 useful, grounded options. Before asking for non-secret facts, check relevant trusted context and connected sources. Use this only when a missing choice actually blocks the requested task. Never invent choices merely to show a panel. For open-ended ordinary questions that require typing a name, address, quantity, date, explanation, or another free-form answer, ask in normal chat and end the turn; do not use text fields for ordinary clarification. Do not duplicate the question in chat. Use secret for sensitive values so they stay encrypted and outside model context. Protected secret fields remain available for necessary sensitive execution details, such as verification codes, PINs, passwords or API keys; prefer existing vault picker/fill flows for saved credentials and payment cards. Never search for passwords, PINs, security codes, or payment-card data. Never expose secrets in chat. Use browser_fill_question_answer to fill protected answers. Do not mix sensitive fields with ordinary preference questions. Never use this tool as action approval or ask whether to perform an already-authorized outcome. An absent target record, draft, booking, event, or submission is not missing information when creating it is the selected outcome. For example, create a requested calendar invitation when the attendee and date/time are known; infer a concise title and use a standard 30-minute duration when none is supplied. Call as the only tool call, then stop and wait for the answers.`,
    inputSchema: askQuestionsInputSchema,
    execute: async ({ questions }) => {
      const args = { questions };
      let action = await input.store.findMatchingAction(input.runId, "ask_questions", args);
      if (action && action.stepId !== input.stepId) action = null;
      if (action?.status === "executed") return action.result ?? { answered: true };
      if (!action || action.status !== "proposed") {
        action = await input.store.createAction({
          runId: input.runId,
          stepId: input.stepId,
          toolName: "ask_questions",
          risk: "read",
          preview: questions.length === 1 ? questions[0]!.question : `${questions.length} quick questions`,
          input: args,
        });
      }
      await input.store.updateRun(input.runId, { status: "paused", error: null });
      throw new QuestionsRequiredError(action);
    },
  });
}
