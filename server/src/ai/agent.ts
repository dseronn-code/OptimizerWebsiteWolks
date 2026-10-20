import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { aiProvider, config } from '../config.js';
import { answerWithOpenAiCompatible } from './openaiCompatAgent.js';
import { MAX_ITERATIONS, SYSTEM_PROMPT } from './prompt.js';
import { interpretLocally } from './localInterpreter.js';
import { executeTool, toolDescriptions, toolSchemas, type Card, type ToolContext, type ToolName } from './tools.js';
import type { Viewer } from '../stock/stockService.js';

/**
 * Agente conversacional. O modelo de linguagem interpreta a pergunta, escolhe ferramentas de
 * consulta e redige a explicação; todos os números vêm das ferramentas (motor determinístico).
 * Provedores: Anthropic, qualquer API compatível com OpenAI (Groq, Gemini…) ou, sem IA configurada,
 * o interpretador local por regras.
 */

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatAnswer {
  answer: string;
  cards: Card[];
  toolCalls: { name: string; input: unknown }[];
  engine: 'llm' | 'local';
  /** Modelo de IA que respondeu (quando engine = 'llm'). */
  model?: string;
  /** Preenchido quando a IA estava configurada mas falhou e o interpretador local respondeu. */
  fallbackReason?: string;
  lastProductId: number | null;
}



let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      apiKey: config.ANTHROPIC_API_KEY,
      maxRetries: 2,
      timeout: 60_000,
      defaultHeaders: config.ANTHROPIC_WORKSPACE_ID ? { 'anthropic-workspace-id': config.ANTHROPIC_WORKSPACE_ID } : undefined,
    });
  }
  return client;
}

function buildTools(): Anthropic.Beta.Messages.BetaTool[] {
  return (Object.keys(toolSchemas) as ToolName[]).map((name) => {
    const schema = z.toJSONSchema(toolSchemas[name]) as Record<string, unknown>;
    delete schema.$schema;
    return {
      name,
      description: toolDescriptions[name],
      input_schema: { type: 'object', ...schema } as Anthropic.Beta.Messages.BetaTool.InputSchema,
    };
  });
}


export async function answerQuestion(
  question: string,
  history: ChatTurn[],
  viewer: Viewer,
  lastProductId: number | null,
): Promise<ChatAnswer> {
  const ctx: ToolContext = { viewer, cards: [], lastProductId };
  const provider = aiProvider();
  if (provider === 'local') {
    const local = await interpretLocally(question, ctx);
    return { ...local, cards: ctx.cards, engine: 'local', lastProductId: ctx.lastProductId };
  }
  if (provider === 'openai_compat') return { ...(await answerWithOpenAiCompatible(question, history, ctx)), model: config.AI_MODEL };

  const tools = buildTools();
  const toolCalls: { name: string; input: unknown }[] = [];
  const context = ctx.lastProductId ? `\n\n(Contexto: o último produto consultado tem id ${ctx.lastProductId}; "esse produto" refere-se a ele.)` : '';
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
    ...history.slice(-10).map((t) => ({ role: t.role, content: t.content })),
    { role: 'user', content: question + context },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await getClient().beta.messages.create({
      model: config.AI_MODEL ?? 'claude-opus-5-5',
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools,
      messages,
      output_config: { effort: config.AI_EFFORT },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });

    if (response.stop_reason === 'refusal') {
      return { answer: 'Não consigo responder a essa solicitação. Reformule a pergunta sobre estoque, pedidos ou reservas.', cards: ctx.cards, toolCalls, engine: 'llm', model: config.AI_MODEL ?? 'claude-opus-5-5', lastProductId: ctx.lastProductId };
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (response.stop_reason !== 'tool_use') {
      if (response.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content });
        continue;
      }
      return { answer: text || 'Não obtive uma resposta.', cards: ctx.cards, toolCalls, engine: 'llm', model: config.AI_MODEL ?? 'claude-opus-5-5', lastProductId: ctx.lastProductId };
    }

    messages.push({ role: 'assistant', content: response.content });
    const toolUses = response.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === 'tool_use');
    const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      toolCalls.push({ name: tu.name, input: tu.input });
      try {
        const out = await executeTool(tu.name, tu.input, ctx);
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(out) });
      } catch (err) {
        results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Erro ao consultar: ${(err as Error).message}`, is_error: true });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  return {
    answer: 'A consulta ficou longa demais. Tente uma pergunta mais específica (produto e quantidade).',
    cards: ctx.cards,
    toolCalls,
    engine: 'llm',
    lastProductId: ctx.lastProductId,
  };
}
