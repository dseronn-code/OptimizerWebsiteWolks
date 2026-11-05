import { ArrowRight, Bot, MessageSquareText, Search, Send, Sparkles, User as UserIcon } from 'lucide-react';
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
  model?: string;
  fallbackReason?: string;
  error?: boolean;
}

const SUGGESTIONS = [
  'Quais produtos estão disponíveis para venda?',
  'O que está sem estoque?',
  'Quais pedidos em aberto estão prendendo estoque?',
  'Quais produtos têm divergências?',
  'Quais reservas estão vencendo?',
  'Quais produtos têm entrada prevista?',
  'Quais produtos estão com saldo negativo no Bling?',
]

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

  const ask = async (question: string, pickProductId?: number) => {
    const q = question.trim();
    if (!q || busy) return;
    setInput('');
    const history = messages.filter((m) => !m.error).slice(-10).map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: 'user', content: q }]);
    setBusy(true);
    try {
      const r = await api.post<ChatAnswer>('/api/chat', { question: q, history, lastProductId, ...(pickProductId ? { pickProductId } : {}) });
      setLastProductId(r.lastProductId);
      setMessages((m) => [...m, { role: 'assistant', content: r.answer, cards: r.cards, engine: r.engine, model: r.model, fallbackReason: r.fallbackReason }]);
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: `Não foi possível consultar: ${(err as Error).message}`, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col px-3 sm:px-6">
      <div className="pt-5">
        <ProductSearch />
      </div>
      <div className="flex-1 space-y-4 py-4">
        {messages.length === 0 && (
          <div className="animate-fade-up py-8 text-center sm:py-12">
            <div className="relative mx-auto mb-5 flex h-16 w-16 items-center justify-center">
              <span className="absolute inset-0 rounded-3xl bg-gradient-to-br from-brand-400 to-brand-700 opacity-30 blur-xl" aria-hidden />
              <span className="relative flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-brand-500 to-brand-800 text-white shadow-[var(--shadow-glow)]"><Sparkles size={28} /></span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              Pergunte sobre <span className="bg-gradient-to-r from-brand-600 to-accent-500 bg-clip-text text-transparent">qualquer produto</span>
            </h1>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-slate-500">
              Os números vêm do cálculo do sistema (saldo do Bling menos compromissos ainda não baixados). A IA só interpreta a pergunta e explica.
            </p>
            <div className="mx-auto mt-8 grid max-w-3xl gap-2.5 text-left sm:grid-cols-2">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  style={{ animationDelay: `${i * 40}ms` }}
                  className="card card-hover group flex animate-fade-up items-center gap-3 px-4 py-3 text-left text-sm font-medium text-slate-700 hover:border-brand-200"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600 transition group-hover:bg-brand-600 group-hover:text-white"><MessageSquareText size={15} /></span>
                  <span className="flex-1">{s}</span>
                  <ArrowRight size={15} className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-500" />
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <MessageView key={i} m={m} onPick={(p) => ask(`${p.sku ?? p.name}`, p.id)} />
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Bot size={16} /></span>
            <span className="flex items-center gap-1 rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-400 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-400 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand-400" />
              <span className="ml-2 text-xs text-slate-500">Consultando estoque e compromissos…</span>
            </span>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <form
        className="sticky bottom-0 -mx-3 bg-gradient-to-t from-slate-50 via-slate-50/95 to-transparent px-3 pb-4 pt-6 sm:-mx-6 sm:px-6"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <div className="flex gap-2 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-[var(--shadow-lift)] focus-within:border-brand-300 focus-within:ring-4 focus-within:ring-brand-100">
          <input
            className="w-full bg-transparent px-3 py-2 text-base text-slate-900 outline-none placeholder:text-slate-400"
            placeholder="Digite sua pergunta sobre o estoque…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={1000}
            aria-label="Pergunta"
          />
          <button className="btn-primary rounded-xl px-4" disabled={busy || !input.trim()} aria-label="Enviar"><Send size={18} /></button>
        </div>
        {messages.length > 0 && (
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {SUGGESTIONS.map((s) => (
              <button type="button" key={s} onClick={() => ask(s)} className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700">
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
      <div className="flex animate-fade-up justify-end gap-2.5">
        <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-gradient-to-br from-brand-500 to-brand-700 px-4 py-2.5 text-sm text-white shadow-[var(--shadow-glow)]">{m.content}</div>
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-200 text-slate-600"><UserIcon size={15} /></span>
      </div>
    );
  }
  const availabilityCards = (m.cards ?? []).filter((c): c is Extract<Card, { type: 'availability' }> => c.type === 'availability');
  // mostra só o último cartão de cada produto
  const uniqueAvail = [...new Map(availabilityCards.map((c) => [c.data.product.id, c])).values()];
  return (
    <div className="flex animate-fade-up gap-2.5">
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${m.error ? 'bg-rose-50 text-rose-500' : 'bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm'}`}><Bot size={16} /></span>
      <div className="min-w-0 flex-1 space-y-3">
        <div className={`whitespace-pre-wrap rounded-2xl rounded-tl-md px-4 py-3 text-sm leading-relaxed shadow-sm ${m.error ? 'border border-rose-200 bg-rose-50 text-rose-800' : 'border border-slate-200/80 bg-white text-slate-800'}`}>
          {m.content}
          {m.engine && <EngineBadge engine={m.engine} model={m.model} fallbackReason={m.fallbackReason} />}
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
              <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">{c.title}</div>
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
        <div className="card absolute z-20 mt-2 w-full animate-fade-in divide-y divide-slate-100 overflow-hidden shadow-[var(--shadow-lift)]">
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

/** Mostra quem respondeu: a IA (modelo de linguagem) ou o sistema (interpretador local por regras). */
function EngineBadge({ engine, model, fallbackReason }: { engine: 'llm' | 'local'; model?: string; fallbackReason?: string }) {
  if (engine === 'llm') {
    return (
      <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700" title={model}>
        <Sparkles size={12} /> Resposta da IA
      </div>
    );
  }
  return (
    <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
      <Bot size={12} /> Resposta do sistema (sem IA){fallbackReason ? ` — ${fallbackReason}` : ''}
    </div>
  );
}
