import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { config } from '../config.js';
import { interpretLocally } from './localInterpreter.js';
import { executeTool, toolDescriptions, toolSchemas, type Card, type ToolContext, type ToolName } from './tools.js';
import type { Viewer } from '../stock/stockService.js';

/**
 * Agente conversacional. O modelo de linguagem interpreta a pergunta, escolhe ferramentas de
 * consulta e redige a explicação; todos os números vêm das ferramentas (motor determinístico).
 * Sem ANTHROPIC_API_KEY, o interpretador local por regras atende as perguntas frequentes.
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
  lastProductId: number | null;
}

const SYSTEM_PROMPT = `Você é o assistente de estoque "Bling Stock AI", usado por vendedores de uma empresa que opera o ERP Bling.

Seu papel: entender a pergunta (inclusive com erros de digitação ou nomes incompletos), chamar as ferramentas de consulta adequadas e explicar o resultado em português do Brasil, de forma objetiva.

Regras obrigatórias:
- Use SOMENTE números retornados pelas ferramentas. Nunca estime, arredonde de forma diferente, some ou subtraia por conta própria quantidades de estoque. Se precisar de um número que nenhuma ferramenta retornou, diga que não há essa informação.
- Para perguntas do tipo "posso/consigo vender N?", use verificar_venda. Para "quanto temos/tem disponível?", use consultar_disponibilidade.
- Se a disponibilidade vier como "NÃO CONFIRMADA", diga isso logo no início, explique os motivos (avisos) e não afirme que a venda é possível; recomende confirmar com o gestor.
- Informe sempre a atualidade dos dados (campo dados_de / saldo_atualizado_agora) e, se a fonte for DEMONSTRAÇÃO, avise que são dados fictícios.
- Se o produto for ambíguo, apresente as opções retornadas e peça para o vendedor escolher. Não escolha por ele.
- Você não altera nada no Bling nem cria reservas: apenas consulta. Se pedirem para reservar/alterar, oriente a usar a tela de Reservas.
- Respeite a privacidade: se um cliente aparecer como "Cliente de outro vendedor", não tente descobrir quem é.

Formato para disponibilidade de um produto (adapte quando fizer sentido):
Produto: <SKU — nome>
Estoque físico registrado: <n>
Pedidos pagos e confirmados ainda não baixados: <n>
Pré-pedidos com reserva válida: <n>
Reservas complementares: <n> (omita linhas zeradas, exceto o físico e o disponível)
Bloqueios operacionais: <n>
Estoque disponível para novas vendas: <n>
Resposta: <conclusão em uma ou duas frases>
Dados de: <data/hora> · Status: <confirmada/não confirmada>`;

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 });
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

const MAX_ITERATIONS = 6;

export async function answerQuestion(
  question: string,
  history: ChatTurn[],
  viewer: Viewer,
  lastProductId: number | null,
): Promise<ChatAnswer> {
  const ctx: ToolContext = { viewer, cards: [], lastProductId };
  if (!config.ANTHROPIC_API_KEY) {
    const local = await interpretLocally(question, ctx);
    return { ...local, cards: ctx.cards, engine: 'local', lastProductId: ctx.lastProductId };
  }

  const tools = buildTools();
  const toolCalls: { name: string; input: unknown }[] = [];
  const context = ctx.lastProductId ? `\n\n(Contexto: o último produto consultado tem id ${ctx.lastProductId}; "esse produto" refere-se a ele.)` : '';
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [
    ...history.slice(-10).map((t) => ({ role: t.role, content: t.content })),
    { role: 'user', content: question + context },
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await getClient().beta.messages.create({
      model: config.AI_MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools,
      messages,
      output_config: { effort: config.AI_EFFORT },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });

    if (response.stop_reason === 'refusal') {
      return { answer: 'Não consigo responder a essa solicitação. Reformule a pergunta sobre estoque, pedidos ou reservas.', cards: ctx.cards, toolCalls, engine: 'llm', lastProductId: ctx.lastProductId };
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
      return { answer: text || 'Não obtive uma resposta.', cards: ctx.cards, toolCalls, engine: 'llm', lastProductId: ctx.lastProductId };
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
