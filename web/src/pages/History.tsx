import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Empty, PageHeader } from '../components/ui';
import { dateTime } from '../format';

interface Item { id: number; question: string; answer: string; engine: string; created_at: string; user_name: string }

export default function History() {
  const { user } = useAuth();
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    api.get<{ history: Item[] }>('/api/history?limit=100').then((r) => setItems(r.history)).catch(() => undefined);
  }, []);
  return (
    <div className="mx-auto max-w-4xl p-3 sm:p-6">
      <PageHeader title="Histórico de consultas" subtitle={user?.role === 'vendedor' ? 'Suas últimas perguntas' : 'Últimas perguntas da equipe'} />
      {items.length === 0 ? <Empty>Nenhuma consulta ainda.</Empty> : (
        <ul className="card divide-y divide-slate-100">
          {items.map((i) => (
            <li key={i.id} className="p-4">
              <button className="w-full text-left" onClick={() => setOpen(open === i.id ? null : i.id)}>
                <div className="text-sm font-medium text-slate-900">{i.question}</div>
                <div className="text-xs text-slate-500">{dateTime(i.created_at)}{user?.role !== 'vendedor' && ` · ${i.user_name}`} · {i.engine === 'llm' ? 'IA' : 'interpretador local'}</div>
              </button>
              {open === i.id && <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm text-slate-700">{i.answer}</pre>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
