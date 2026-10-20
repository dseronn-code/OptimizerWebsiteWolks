import { Bot, Search, Send, Sparkles, User as UserIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, qs } from '../api';
import AvailabilityCard from '../components/AvailabilityCard';
import { Table } from '../components/ui';
import type { Card, ChatAnswer, ProductMatch } from '../types';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  cards?: Card[];
  engine?: 'llm' | 'local';
  error?: boolean;
}

const SUGGESTIONS = [
  'Temos 50 unidades do produto ABC disponíveis para vender agora?',
  'Por que aparecem 150 unidades no Bling, mas somente 70 disponíveis no ABC?',
  'Quais pedidos estão prendendo o estoque desse produto?',
  'Quais pré-pedidos aguardam transportadora?',
  'O que o cliente João tem reservado?',
  'Quais produtos têm divergências?',
  'Quais reservas estão vencendo?',
  'Tem alguma entrada prevista para amanhã?',
  'Quanto teremos disponível se o cliente cancelar o pedido 1201?',
];

const STORAGE_KEY = 'bsa-chat';

function loadSaved(): { messages: Message[]; lastProductId: number | null } {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* armazenamento indisponível */
  }
  return { messages: [], lastProductId: null };
}

export default function Assistant() {
  const saved = loadSaved();
  const [messages, setMessages] = useState<Message[]>(saved.messages);
  const [lastProductId, setLastProductId] = useState<number | null>(saved.lastProductId);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ messages: messages.slice(-30), lastProductId }));
    } catch {
      /* ignora */
    }
  }, [messages, lastProductId]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setInput('');
    const history = messages.filter((m) => !m.error).slice(-10).map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: 'user', content: q }]);
    setBusy(true);
    try {
      const r = await api.post<ChatAnswer>('/api/chat', { question: q, history, lastProductId });
      setLastProductId(r.lastProductId);
      setMessages((m) => [...m, { role: 'assistant', content: r.answer, cards: r.cards, engine: r.engine }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: `Não foi possível consultar: ${(err as Error).message}`, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col px-3 sm:px-6">
      <div className="pt-4">
        <ProductSearch />
      </div>
      <div className="flex-1 space-y-4 py-4">
        {messages.length === 0 && (
          <div className="py-6 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-600"><Sparkles /></div>
            <h1 className="text-lg font-semibold text-slate-900">Pergunte sobre a disponibilidade de qualquer produto</h1>
            <p className="mx-auto mt-1 max-w-lg text-sm text-slate-500">
              Os números vêm do cálculo do sistema (saldo do Bling menos compromissos ainda não baixados). A IA só interpreta a pergunta e explica.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => ask(s)} className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-left text-sm text-slate-700 hover:border-brand-300 hover:bg-brand-50">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageView key={i} m={m} onPick={(p) => ask(`${p.sku ?? p.name}`)} />
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Bot size={18} className="animate-pulse" /> Consultando estoque e compromissos…
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form
        className="sticky bottom-0 -mx-3 border-t border-slate-200 bg-slate-50/95 px-3 py-3 backdrop-blur sm:-mx-6 sm:px-6"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <div className="flex gap-2">
          <input
            className="input py-2.5 text-base"
            placeholder='Ex.: "Consigo vender 35 peças do ABC agora?"'
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={1000}
            aria-label="Pergunta"
          />
          <button className="btn-primary px-4" disabled={busy || !input.trim()} aria-label="Enviar"><Send size={18} /></button>
        </div>
        {messages.length > 0 && (
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {SUGGESTIONS.slice(2, 8).map((s) => (
              <button type="button" key={s} onClick={() => ask(s)} className="shrink-0 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-brand-50">
                {s}
              </button>
            ))}
            <button type="button" onClick={() => { setMessages([]); setLastProductId(null); }} className="shrink-0 rounded-full px-2.5 py-1 text-xs text-slate-500 underline">
              Limpar conversa
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

function MessageView({ m, onPick }: { m: Message; onPick: (p: ProductMatch) => void }) {
  if (m.role === 'user') {
    return (
      <div className="flex justify-end gap-2">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-brand-600 px-4 py-2 text-sm text-white">{m.content}</div>
        <UserIcon size={18} className="mt-2 shrink-0 text-slate-400" />
      </div>
    );
  }
  const availabilityCards = (m.cards ?? []).filter((c): c is Extract<Card, { type: 'availability' }> => c.type === 'availability');
  // mostra só o último cartão de cada produto
  const uniqueAvail = [...new Map(availabilityCards.map((c) => [c.data.product.id, c])).values()];
  return (
    <div className="flex gap-2">
      <Bot size={18} className={`mt-2 shrink-0 ${m.error ? 'text-rose-500' : 'text-brand-500'}`} />
      <div className="min-w-0 flex-1 space-y-3">
        <div className={`whitespace-pre-wrap rounded-2xl rounded-tl-sm px-4 py-3 text-sm ${m.error ? 'bg-rose-50 text-rose-800' : 'border border-slate-200 bg-white text-slate-800'}`}>
          {m.content}
          {m.engine === 'local' && <div className="mt-2 text-[11px] text-slate-400">Resposta gerada pelo interpretador local</div>}
        </div>
        {uniqueAvail.map((c) => (
          <AvailabilityCard key={c.data.product.id} data={c.data} sale={c.sale} compact />
        ))}
        {(m.cards ?? []).map((c, i) =>
          c.type === 'candidates' ? (
            <div key={i} className="card divide-y divide-slate-100">
              {c.data.map((p) => (
                <button key={p.id} onClick={() => onPick(p)} className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-brand-50">
                  <span><span className="font-semibold text-brand-600">{p.sku ?? '—'}</span> · {p.name}</span>
                  <span className="text-xs text-slate-400">{Math.round(p.score * 100)}%</span>
                </button>
              ))}
            </div>
          ) : c.type === 'table' ? (
            <div key={i} className="card overflow-hidden">
              <div className="border-b border-slate-100 px-4 py-2 text-sm font-medium">{c.title}</div>
              <Table columns={c.columns}>
                {c.rows.map((r, j) => (
                  <tr key={j}>{r.map((v, k) => <td key={k} className="td">{v ?? '—'}</td>)}</tr>
                ))}
              </Table>
            </div>
          ) : null,
        )}
      </div>
    </div>
  );
}

function ProductSearch() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ProductMatch[]>([]);
  const nav = useNavigate();
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api.get<{ results: ProductMatch[] }>(`/api/products/search${qs({ q })}`).then((r) => setResults(r.results)).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="relative">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input
        className="input pl-9"
        placeholder="Buscar produto por nome ou SKU…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) nav(`/produtos/${results[0].id}`);
        }}
        aria-label="Buscar produto"
      />
      {results.length > 0 && (
        <div className="card absolute z-20 mt-1 w-full divide-y divide-slate-100 overflow-hidden">
          {results.map((p) => (
            <Link key={p.id} to={`/produtos/${p.id}`} onClick={() => setQ('')} className="block px-4 py-2 text-sm hover:bg-brand-50">
              <span className="font-semibold text-brand-600">{p.sku ?? '—'}</span> · {p.name}
              {!p.active && <span className="ml-2 text-xs text-slate-400">(inativo)</span>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
