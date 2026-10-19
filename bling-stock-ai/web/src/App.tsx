import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import Layout from './components/Layout';
import Admin from './pages/Admin';
import Alerts from './pages/Alerts';
import Assistant from './pages/Assistant';
import Dashboard from './pages/Dashboard';
import History from './pages/History';
import Login from './pages/Login';
import Orders from './pages/Orders';
import Product from './pages/Product';
import Reservations from './pages/Reservations';
import type { Role } from './types';

function Guard({ roles, children }: { roles?: Role[]; children: React.ReactElement }) {
  const { user } = useAuth();
  if (roles && user && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-full items-center justify-center text-slate-500">Carregando…</div>;
  if (!user) return <Login />;
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Assistant />} />
        <Route path="/produtos/:id" element={<Product />} />
        <Route path="/pedidos" element={<Orders />} />
        <Route path="/reservas" element={<Reservations />} />
        <Route path="/alertas" element={<Alerts />} />
        <Route path="/historico" element={<History />} />
        <Route path="/gestao" element={<Guard roles={['gestor', 'admin']}><Dashboard /></Guard>} />
        <Route path="/admin" element={<Guard roles={['admin', 'gestor']}><Admin /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
