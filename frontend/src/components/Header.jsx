import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';

const Header = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { path: '/', label: 'Início' },
    { path: '/servicos', label: 'Serviços' },
    { path: '/requisitos', label: 'Requisitos' },
    { path: '/processo', label: 'Processo' },
    { path: '/contato', label: 'Contato' }
  ];

  return (
    <header
      style={{
        background: isScrolled ? 'rgba(0, 0, 0, 0.95)' : 'var(--bg-primary)',
        borderBottom: `1px solid ${isScrolled ? 'var(--border-medium)' : 'var(--border-subtle)'}`,
        padding: '16px 7.6923%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'fixed',
        top: 0,
        width: '100%',
        height: '80px',
        zIndex: 1000,
        boxSizing: 'border-box',
        backdropFilter: isScrolled ? 'blur(12px)' : 'none',
        transition: 'all 0.4s ease-in-out'
      }}
    >
      <Link to="/" style={{ textDecoration: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '40px',
            height: '40px',
            background: 'linear-gradient(135deg, var(--brand-primary), var(--brand-active))',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: '20px',
            color: '#000'
          }}>
            W
          </div>
          <span style={{
            fontSize: '24px',
            fontWeight: 600,
            color: 'var(--text-primary)',
            letterSpacing: '-0.02em'
          }}>
            Wolks Optimizer
          </span>
        </div>
      </Link>

      <nav style={{ display: 'flex', alignItems: 'center', gap: '32px' }}>
        <div style={{ display: 'flex', gap: '32px' }} className="desktop-nav">
          {navLinks.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              style={{
                color: location.pathname === link.path ? 'var(--brand-primary)' : 'var(--text-muted)',
                textDecoration: 'none',
                fontSize: '18px',
                fontWeight: location.pathname === link.path ? 600 : 400,
                transition: 'color 0.3s ease',
                position: 'relative'
              }}
              onMouseEnter={(e) => {
                if (location.pathname !== link.path) {
                  e.target.style.color = 'var(--text-primary)';
                }
              }}
              onMouseLeave={(e) => {
                if (location.pathname !== link.path) {
                  e.target.style.color = 'var(--text-muted)';
                }
              }}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="mobile-menu-button"
          style={{
            display: 'none',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            padding: '8px'
          }}
        >
          {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </nav>

      {mobileMenuOpen && (
        <div
          className="mobile-nav"
          style={{
            position: 'fixed',
            top: '80px',
            left: 0,
            right: 0,
            background: 'rgba(0, 0, 0, 0.98)',
            backdropFilter: 'blur(12px)',
            padding: '20px',
            display: 'none',
            flexDirection: 'column',
            gap: '16px',
            borderBottom: '1px solid var(--border-subtle)'
          }}
        >
          {navLinks.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              onClick={() => setMobileMenuOpen(false)}
              style={{
                color: location.pathname === link.path ? 'var(--brand-primary)' : 'var(--text-primary)',
                textDecoration: 'none',
                fontSize: '18px',
                fontWeight: location.pathname === link.path ? 600 : 400,
                padding: '12px 0'
              }}
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}

      <style>{`
        @media (max-width: 768px) {
          .desktop-nav {
            display: none !important;
          }
          .mobile-menu-button {
            display: block !important;
          }
          .mobile-nav {
            display: flex !important;
          }
        }
      `}</style>
    </header>
  );
};

export default Header;
