import React from 'react';
import { Link } from 'react-router-dom';
import { Instagram, Twitter, Mail } from 'lucide-react';

const Footer = () => {
  return (
    <footer style={{
      background: 'var(--bg-secondary)',
      borderTop: '1px solid var(--border-subtle)',
      padding: '60px 7.6923%',
      marginTop: '100px'
    }}>
      <div style={{
        maxWidth: '1400px',
        margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        gap: '40px'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
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
              fontSize: '20px',
              fontWeight: 600,
              color: 'var(--text-primary)'
            }}>
              Wolks Optimizer
            </span>
          </div>
          <p style={{
            color: 'var(--text-secondary)',
            fontSize: '16px',
            lineHeight: '1.5',
            marginTop: '12px'
          }}>
            Otimização profissional de computadores para máximo desempenho em jogos e trabalho.
          </p>
        </div>

        <div>
          <h3 style={{
            fontSize: '18px',
            fontWeight: 600,
            color: 'var(--text-primary)',
            marginBottom: '16px'
          }}>
            Links Rápidos
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Link to="/servicos" style={{
              color: 'var(--text-secondary)',
              textDecoration: 'none',
              fontSize: '16px',
              transition: 'color 0.3s ease'
            }}
            onMouseEnter={(e) => e.target.style.color = 'var(--brand-primary)'}
            onMouseLeave={(e) => e.target.style.color = 'var(--text-secondary)'}
            >
              Tipos de Otimização
            </Link>
            <Link to="/requisitos" style={{
              color: 'var(--text-secondary)',
              textDecoration: 'none',
              fontSize: '16px',
              transition: 'color 0.3s ease'
            }}
            onMouseEnter={(e) => e.target.style.color = 'var(--brand-primary)'}
            onMouseLeave={(e) => e.target.style.color = 'var(--text-secondary)'}
            >
              Requisitos
            </Link>
            <Link to="/processo" style={{
              color: 'var(--text-secondary)',
              textDecoration: 'none',
              fontSize: '16px',
              transition: 'color 0.3s ease'
            }}
            onMouseEnter={(e) => e.target.style.color = 'var(--brand-primary)'}
            onMouseLeave={(e) => e.target.style.color = 'var(--text-secondary)'}
            >
              Processo
            </Link>
          </div>
        </div>

        <div>
          <h3 style={{
            fontSize: '18px',
            fontWeight: 600,
            color: 'var(--text-primary)',
            marginBottom: '16px'
          }}>
            Contato
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <a href="mailto:d.seronn@gmail.com" style={{
              color: 'var(--text-secondary)',
              textDecoration: 'none',
              fontSize: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              transition: 'color 0.3s ease'
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--brand-primary)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-secondary)'}
            >
              <Mail size={18} />
              d.seronn@gmail.com
            </a>
            <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
              <a
                href="https://instagram.com/wolks.optimizer"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--text-secondary)',
                  transition: 'color 0.3s ease'
                }}
                onMouseEnter={(e) => e.target.style.color = 'var(--brand-primary)'}
                onMouseLeave={(e) => e.target.style.color = 'var(--text-secondary)'}
              >
                <Instagram size={24} />
              </a>
              <a
                href="https://twitter.com/wolksoptimizer"
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  color: 'var(--text-secondary)',
                  transition: 'color 0.3s ease'
                }}
                onMouseEnter={(e) => e.target.style.color = 'var(--brand-primary)'}
                onMouseLeave={(e) => e.target.style.color = 'var(--text-secondary)'}
              >
                <Twitter size={24} />
              </a>
            </div>
          </div>
        </div>
      </div>

      <div style={{
        maxWidth: '1400px',
        margin: '40px auto 0',
        paddingTop: '20px',
        borderTop: '1px solid var(--border-subtle)',
        textAlign: 'center',
        color: 'var(--text-muted)',
        fontSize: '14px'
      }}>
        © {new Date().getFullYear()} Wolks Optimizer. Todos os direitos reservados.
      </div>
    </footer>
  );
};

export default Footer;
