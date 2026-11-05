import { describe, expect, it } from 'vitest';
import { suggestRule } from '../src/sync/situationSuggestions.js';

describe('sugestão de regras de situação (nomes do Bling)', () => {
  it('classifica as situações padrão de forma conservadora', () => {
    expect(suggestRule('Atendido')?.category).toBe('FULFILLED');
    expect(suggestRule('Atendido')?.stockEffect).toBe('POSTED');
    expect(suggestRule('Cancelado')?.category).toBe('CANCELLED');
    expect(suggestRule('Em aberto')?.category).toBe('COMMITTED');
    expect(suggestRule('Em andamento')?.category).toBe('COMMITTED');
    expect(suggestRule('Verificado')?.category).toBe('COMMITTED');
    expect(suggestRule('Em digitação')?.category).toBe('OPPORTUNITY');
    expect(suggestRule('Aguardando transportadora')?.category).toBe('COMMITTED');
    expect(suggestRule('Pago - aguardando retirada')?.category).toBe('COMMITTED');
    expect(suggestRule('Venda Agenciada')).toBeNull(); // desconhecida: fica para o administrador decidir
  });
});
