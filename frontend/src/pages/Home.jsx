import React, { useState } from 'react';
import Spline from '@splinetool/react-spline';
import { ArrowRight, Cpu, Zap, Shield, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import ContactModal from '../components/ContactModal';

const Home = () => {
  const [contactModalOpen, setContactModalOpen] = useState(false);

  return (
    <div style={{ background: 'var(--bg-primary)', minHeight: '100vh', paddingTop: '80px' }}>
      {/* Hero Section with Spline 3D */}
      <section style={{
        minHeight: 'calc(100vh - 80px)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 7.6923%',
        position: 'relative',
        overflow: 'hidden'
      }}>
        <div style={{
          maxWidth: '1400px',
          margin: '0 auto',
          width: '100%',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '60px',
          alignItems: 'center'
        }} className="hero-grid">
          <div style={{ zIndex: 2 }}>
            <div style={{
              display: 'inline-block',
              padding: '8px 16px',
              background: 'var(--brand-hover)',
              border: '1px solid var(--brand-primary)',
              borderRadius: '20px',
              fontSize: '14px',
              fontWeight: 600,
              color: 'var(--brand-primary)',
              marginBottom: '24px'
            }}>
              Otimização Profissional
            </div>
            
            <h1 style={{
              fontSize: '66px',
              fontWeight: 600,
              lineHeight: '1.1',
              letterSpacing: '-0.62px',
              color: 'var(--text-primary)',
              marginBottom: '24px'
            }}>
              Turbine Seu PC ao
              <span style={{ color: 'var(--brand-primary)' }}> Máximo</span>
            </h1>
            
            <p style={{
              fontSize: '20px',
              fontWeight: 400,
              lineHeight: '1.5',
              color: 'var(--text-secondary)',
              marginBottom: '40px',
              maxWidth: '540px'
            }}>
              Otimização completa de computadores com ganhos reais de performance. 
              Mais FPS, menos latência e melhor temperatura.
            </p>

            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <button
                onClick={() => setContactModalOpen(true)}
                style={{
                  background: 'var(--brand-primary)',
                  color: '#000000',
                  border: 'none',
                  borderRadius: '0px',
                  padding: '18px 32px',
                  fontSize: '18px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.4s ease-in-out',
                  minHeight: '56px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '12px'
                }}
                onMouseEnter={(e) => {
                  e.target.style.background = 'var(--brand-hover)';
                  e.target.style.color = 'var(--brand-primary)';
                  e.target.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.target.style.background = 'var(--brand-primary)';
                  e.target.style.color = '#000000';
                  e.target.style.transform = 'translateY(0)';
                }}
              >
                Adquirir Otimização
                <ArrowRight size={20} />
              </button>

              <Link to="/servicos">
                <button
                  style={{
                    background: 'rgba(255, 255, 255, 0.1)',
                    color: '#FFFFFF',
                    border: 'none',
                    borderRadius: '0px',
                    padding: '18px 32px',
                    fontSize: '18px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.4s ease-in-out',
                    minHeight: '56px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '12px'
                  }}
                  onMouseEnter={(e) => {
                    e.target.style.background = '#FFFFFF';
                    e.target.style.color = '#000000';
                  }}
                  onMouseLeave={(e) => {
                    e.target.style.background = 'rgba(255, 255, 255, 0.1)';
                    e.target.style.color = '#FFFFFF';
                  }}
                >
                  Ver Serviços
                  <ChevronRight size={20} />
                </button>
              </Link>
            </div>

            <div style={{
              display: 'flex',
              gap: '40px',
              marginTop: '60px',
              flexWrap: 'wrap'
            }}>
              <div>
                <div style={{
                  fontSize: '32px',
                  fontWeight: 700,
                  color: 'var(--brand-primary)',
                  marginBottom: '4px'
                }}>
                  R$ 260
                </div>
                <div style={{
                  fontSize: '14px',
                  color: 'var(--text-muted)'
                }}>
                  Pagamento em 2x
                </div>
              </div>
              <div>
                <div style={{
                  fontSize: '32px',
                  fontWeight: 700,
                  color: 'var(--brand-primary)',
                  marginBottom: '4px'
                }}>
                  Vitalício
                </div>
                <div style={{
                  fontSize: '14px',
                  color: 'var(--text-muted)'
                }}>
                  Otimização permanente
                </div>
              </div>
            </div>
          </div>

          <div style={{
            width: '700px',
            height: '700px',
            overflow: 'visible',
            position: 'relative'
          }} className="spline-container">
            <Spline scene="https://prod.spline.design/NbVmy6DPLhY-5Lvg/scene.splinecode" />
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section style={{
        padding: '100px 7.6923%',
        background: 'var(--bg-secondary)'
      }}>
        <div style={{
          maxWidth: '1400px',
          margin: '0 auto'
        }}>
          <div style={{ textAlign: 'center', marginBottom: '60px' }}>
            <h2 style={{
              fontSize: '48px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '16px',
              letterSpacing: '-0.02em'
            }}>
              Por Que Escolher a Wolks?
            </h2>
            <p style={{
              fontSize: '20px',
              color: 'var(--text-secondary)',
              maxWidth: '600px',
              margin: '0 auto'
            }}>
              Resultados comprovados e suporte completo durante todo o processo
            </p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))',
            gap: '40px'
          }}>
            <div style={{
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              padding: '40px',
              transition: 'all 0.4s ease-in-out'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--brand-primary)';
              e.currentTarget.style.transform = 'translateY(-4px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-subtle)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
            >
              <div style={{
                width: '56px',
                height: '56px',
                background: 'var(--brand-hover)',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '20px'
              }}>
                <Cpu size={28} color="var(--brand-primary)" />
              </div>
              <h3 style={{
                fontSize: '24px',
                fontWeight: 600,
                color: 'var(--text-primary)',
                marginBottom: '12px'
              }}>
                Todos os Jogos
              </h3>
              <p style={{
                fontSize: '16px',
                color: 'var(--text-secondary)',
                lineHeight: '1.6'
              }}>
                Fortnite, Valorant, CS:GO, Warzone e todos os outros. 
                Otimização eficiente para qualquer jogo competitivo ou casual.
              </p>
            </div>

            <div style={{
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              padding: '40px',
              transition: 'all 0.4s ease-in-out'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--brand-primary)';
              e.currentTarget.style.transform = 'translateY(-4px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-subtle)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
            >
              <div style={{
                width: '56px',
                height: '56px',
                background: 'var(--brand-hover)',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '20px'
              }}>
                <Zap size={28} color="var(--brand-primary)" />
              </div>
              <h3 style={{
                fontSize: '24px',
                fontWeight: 600,
                color: 'var(--text-primary)',
                marginBottom: '12px'
              }}>
                Programas Profissionais
              </h3>
              <p style={{
                fontSize: '16px',
                color: 'var(--text-secondary)',
                lineHeight: '1.6'
              }}>
                OBS, StreamLabs, Sony Vegas, PhotoShop e outros. 
                Melhor desempenho em streaming, edição e renderização.
              </p>
            </div>

            <div style={{
              background: 'var(--bg-primary)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '12px',
              padding: '40px',
              transition: 'all 0.4s ease-in-out'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--brand-primary)';
              e.currentTarget.style.transform = 'translateY(-4px)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-subtle)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
            >
              <div style={{
                width: '56px',
                height: '56px',
                background: 'var(--brand-hover)',
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '20px'
              }}>
                <Shield size={28} color="var(--brand-primary)" />
              </div>
              <h3 style={{
                fontSize: '24px',
                fontWeight: 600,
                color: 'var(--text-primary)',
                marginBottom: '12px'
              }}>
                Permanente e Seguro
              </h3>
              <p style={{
                fontSize: '16px',
                color: 'var(--text-secondary)',
                lineHeight: '1.6'
              }}>
                Configurações salvas na BIOS. Overclock seguro que aumenta 
                a vida útil do processador com temperaturas reduzidas.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section style={{
        padding: '100px 7.6923%',
        background: 'var(--bg-primary)'
      }}>
        <div style={{
          maxWidth: '800px',
          margin: '0 auto',
          textAlign: 'center',
          padding: '60px',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '12px'
        }}>
          <h2 style={{
            fontSize: '48px',
            fontWeight: 600,
            color: 'var(--text-primary)',
            marginBottom: '16px',
            letterSpacing: '-0.02em'
          }}>
            Pronto para Turbinar seu PC?
          </h2>
          <p style={{
            fontSize: '20px',
            color: 'var(--text-secondary)',
            marginBottom: '40px'
          }}>
            Entre em contato e agende sua otimização profissional
          </p>
          <button
            onClick={() => setContactModalOpen(true)}
            style={{
              background: 'var(--brand-primary)',
              color: '#000000',
              border: 'none',
              borderRadius: '0px',
              padding: '18px 40px',
              fontSize: '18px',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.4s ease-in-out',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '12px'
            }}
            onMouseEnter={(e) => {
              e.target.style.background = 'var(--brand-hover)';
              e.target.style.color = 'var(--brand-primary)';
              e.target.style.transform = 'scale(1.05)';
            }}
            onMouseLeave={(e) => {
              e.target.style.background = 'var(--brand-primary)';
              e.target.style.color = '#000000';
              e.target.style.transform = 'scale(1)';
            }}
          >
            Fale Conosco Agora
            <ArrowRight size={20} />
          </button>
        </div>
      </section>

      <ContactModal isOpen={contactModalOpen} onClose={() => setContactModalOpen(false)} />

      <style>{`
        @media (max-width: 1024px) {
          .hero-grid {
            grid-template-columns: 1fr !important;
            gap: 40px !important;
          }
          .spline-container {
            width: 100% !important;
            height: 500px !important;
          }
          h1 {
            font-size: 48px !important;
          }
        }
        @media (max-width: 768px) {
          h1 {
            font-size: 36px !important;
          }
        }
      `}</style>
    </div>
  );
};

export default Home;
