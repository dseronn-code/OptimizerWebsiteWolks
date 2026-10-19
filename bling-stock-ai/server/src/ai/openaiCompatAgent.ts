import { z } from 'zod';
import { config } from '../config.js';
import type { ChatAnswer, ChatTurn } from './agent.js';
import { MAX_ITERATIONS, SYSTEM_PROMPT } from './prompt.js';
import { executeTool, toolDescriptions, toolSchemas, type ToolContext, type ToolName } from './tools.js';

/**
 * Agente para provedores com API compatível com OpenAI (/chat/completions + tools), o que inclui
 * planos gratuitos como Groq e Google Gemini, além de modelos locais via Ollama.
 * Mesmas regras do agente principal: o modelo só escolhe ferramentas e explica; os números vêm do motor.
 */

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

type Message =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

interface CompletionResponse {
  choices?: { message: { content: string | null; tool_calls?: ToolCall[] }; finish_reason: string }[];
  error?: { message?: string };
}

const KEEP = new Set(['type', 'description', 'properties', 'required', 'items', 'enum', 'minimum', 'maximum']);

/**
 * Reduz o JSON Schema ao subconjunto aceito por todos os provedores (o Gemini, por exemplo,
 * recusa `additionalProperties` e `$schema`). A validação completa continua no backend (zod).
 */
export function simplifySchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(simplifySchema);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === 'exclusiveMinimum' && typeof v === 'number') out.minimum = v;
    else if (k === 'properties') out.properties = Object.fromEntries(Object.entries(v as object).map(([pk, pv]) => [pk, simplifySchema(pv)]));
    else if (KEEP.has(k)) out[k] = simplifySchema(v);
  }
  return out;
}

function buildTools() {
  return (Object.keys(toolSchemas) as ToolName[]).map((name) => ({
    type: 'function' as const,
    function: {
      name,
      description: toolDescriptions[name],
      parameters: { type: 'object', properties: {}, ...(simplifySchema(z.toJSONSchema(toolSchemas[name])) as object) },
    },
  }));
}

async function complete(messages: Message[], tools: ReturnType<typeof buildTools>): Promise<CompletionResponse> {
  const url = `${config.AI_BASE_URL!.replace(/\/+$/, '')}/chat/completions`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.AI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.AI_MODEL, messages, tools, tool_choice: 'auto', temperature: 0.1 }),
      signal: AbortSignal.timeout(60_000),
    });
    // Planos gratuitos têm limite por minuto: uma nova tentativa curta antes de desistir.
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      const retryAfter = Number(res.headers.get('retry-after'));
      await new Promise((r) => setTimeout(r, Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 2000 * (attempt + 1)));
      continue;
    }
    const body = (await res.json().catch(() => ({}))) as CompletionResponse;
    if (!res.ok) throw new Error(`Provedor de IA respondeu ${res.status}: ${body.error?.message ?? 'erro desconhecido'}`);
    return body;
  }
}

export async function answerWithOpenAiCompatible(question: string, history: ChatTurn[], ctx: ToolContext): Promise<ChatAnswer> {
  const tools = buildTools();
  const toolCalls: { name: string; input: unknown }[] = [];
  const context = ctx.lastProductId ? `\n\n(Contexto: o último produto consultado tem id ${ctx.lastProductId}; "esse produto" refere-se a ele.)` : '';
  const messages: Message[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-10).map((t) => ({ role: t.role, content: t.content }) as Message),
    { role: 'user', content: question + context },
  ];
  const done = (answer: string): ChatAnswer => ({ answer, cards: ctx.cards, toolCalls, engine: 'llm', lastProductId: ctx.lastProductId });

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const res = await complete(messages, tools);
    const choice = res.choices?.[0];
    if (!choice) throw new Error('Provedor de IA retornou resposta vazia');
    const calls = choice.message.tool_calls ?? [];
    if (calls.length === 0) return done(choice.message.content?.trim() || 'Não obtive uma resposta.');

    messages.push({ role: 'assistant', content: choice.message.content ?? null, tool_calls: calls });
    for (const call of calls) {
      let input: unknown;
      try {
        input = JSON.parse(call.function.arguments || '{}');
      } catch {
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ erro: 'argumentos em JSON inválido' }) });
        continue;
      }
      toolCalls.push({ name: call.function.name, input });
      let out: unknown;
      try {
        out = await executeTool(call.function.name, input, ctx);
      } catch (err) {
        out = { erro: `Erro ao consultar: ${(err as Error).message}` };
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(out) });
    }
  }
  return done('A consulta ficou longa demais. Tente uma pergunta mais específica (produto e quantidade).');
}
