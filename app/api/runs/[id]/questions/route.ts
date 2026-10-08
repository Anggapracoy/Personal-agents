import { threadItems } from "../../../../../lib/harness/thread";
import { NextResponse } from "next/server";
import { resumeRun } from "../../../../../lib/harness/resume";
import {
  answerQuestionsInputSchema,
  askQuestionsInputSchema,
  questionSecretKey,
  type StoredQuestionResponse,
} from "../../../../../lib/harness/questions";
import { getRunStore } from "../../../../../lib/harness/store";
import { getOwnedRunSnapshot } from "../../../../../lib/auth/session";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const parsedRequest = answerQuestionsInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsedRequest.success) return NextResponse.json({ error: "Answer every question before continuing." }, { status: 400 });

  const owned = await getOwnedRunSnapshot(id);
  if (owned.status === 401) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  if (!owned.snapshot || !owned.email) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  if (owned.snapshot.status !== "paused") return NextResponse.json({ error: "This task is no longer waiting for answers." }, { status: 409 });

  const store = getRunStore();
  const action = await store.getAction(parsedRequest.data.actionId, id);
  if (!action || action.toolName !== "ask_questions" || action.status !== "proposed") {
    return NextResponse.json({ error: "These questions are no longer waiting for answers." }, { status: 409 });
  }
  const parsedQuestions = askQuestionsInputSchema.safeParse(action.input);
  if (!parsedQuestions.success) return NextResponse.json({ error: "The stored questions are invalid." }, { status: 500 });

  const responseById = new Map(parsedRequest.data.responses.map((response) => [response.questionId, response]));
  if (responseById.size !== parsedQuestions.data.questions.length || parsedRequest.data.responses.length !== parsedQuestions.data.questions.length) {
    return NextResponse.json({ error: "Answer every question before continuing." }, { status: 400 });
  }

  const storedResponses: StoredQuestionResponse[] = [];
  for (const question of parsedQuestions.data.questions) {
    const response = responseById.get(question.id);
    if (!response) return NextResponse.json({ error: `Answer “${question.question}” before continuing.` }, { status: 400 });
    const optionIds = new Set(question.options.map((option) => option.id));
    const validSelections = response.selectedOptionIds.every((optionId) => optionIds.has(optionId));
    const isChoice = question.answerType === "single_choice" || question.answerType === "multiple_choice";
    if (isChoice) {
      const expectedMaximum = question.answerType === "single_choice" ? 1 : question.options.length;
      if (!validSelections || response.selectedOptionIds.length < 1 || response.selectedOptionIds.length > expectedMaximum || response.text.length > 0) {
        return NextResponse.json({ error: `Choose a valid answer for “${question.question}”.` }, { status: 400 });
      }
      storedResponses.push({ questionId: question.id, answerType: question.answerType, selectedOptionIds: response.selectedOptionIds, text: null, secretKey: null });
      continue;
    }
    if (response.selectedOptionIds.length > 0 || response.text.length < 1) {
      return NextResponse.json({ error: `Enter an answer for “${question.question}”.` }, { status: 400 });
    }
    if (question.answerType === "secret") {
      const secretKey = questionSecretKey(action.id, question.id);
      await store.putSecret(id, secretKey, response.text);
      storedResponses.push({ questionId: question.id, answerType: question.answerType, selectedOptionIds: [], text: null, secretKey });
    } else {
      storedResponses.push({ questionId: question.id, answerType: question.answerType, selectedOptionIds: [], text: response.text.trim(), secretKey: null });
    }
  }

  const answered = await store.answerQuestionAction(action.id, id, owned.email, { answered: true, responses: storedResponses });
  if (!answered) return NextResponse.json({ error: "These questions are no longer waiting for answers." }, { status: 409 });

  try {
    await resumeRun(store, id, "The user answered your questions; the answers are in the prior-pauses context. Continue.");
  } catch {
    await store.reopenQuestionAction(action.id, id);
    return NextResponse.json({ error: "The agent could not resume. Your answers are still here - try Continue again." }, { status: 503 });
  }
  const snapshot = await store.getSnapshot(id);
  return NextResponse.json(snapshot ? { ...snapshot, threadItems: threadItems(snapshot, await store.listMessages(id)) } : snapshot, { status: 202 });
}
