import { MAX_RESEARCH_TEXT_LENGTH } from './limits';

type ExchangeMessage = {
  role: string;
  content: string;
  status: string;
};

export function contextualQuestion(
  question: string,
  messages: ExchangeMessage[],
) {
  const intro = 'Previous conversation for context:\n';
  const ending = `\nCurrent user question: ${question}\nAnswer the current question using the prior conversation to resolve references. Retrieve new data where needed.`;
  let remaining = MAX_RESEARCH_TEXT_LENGTH - intro.length - ending.length;
  if (remaining < 100) return question;
  const exchanges: string[] = [];
  for (let i = messages.length - 1; i > 0 && exchanges.length < 4; i--) {
    const answer = messages[i];
    const prior = messages[i - 1];
    if (
      answer.role !== 'assistant' ||
      answer.status !== 'complete' ||
      !answer.content.trim() ||
      prior.role !== 'user'
    )
      continue;
    const head = 'User: ';
    const middle = '\nIroh: ';
    const needed = head.length + middle.length + 2;
    if (remaining <= needed) break;
    const priorText = prior.content.slice(
      0,
      Math.min(remaining - needed, 1000),
    );
    const answerText = answer.content.slice(
      0,
      Math.min(remaining - needed - priorText.length, 1500),
    );
    exchanges.unshift(head + priorText + middle + answerText);
    remaining -=
      head.length + priorText.length + middle.length + answerText.length + 2;
    i--;
  }
  return exchanges.length ? intro + exchanges.join('\n\n') + ending : question;
}
