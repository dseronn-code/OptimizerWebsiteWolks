import React, { useState } from 'react';
import { Instagram, Twitter, Mail, MapPin, Clock } from 'lucide-react';
import ContactModal from '../components/ContactModal';

const Contact = () => {
  const [contactModalOpen, setContactModalOpen] = useState(false);

  return (
    <div style={{ background: 'var(--bg-primary)', minHeight: '100vh', paddingTop: '80px' }}>
      <section style={{ padding: '100px 7.6923%' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '60px' }}>
            <h1 style={{
              fontSize: '66px',
              fontWeight: 600,
              lineHeight: '1.1',
              letterSpacing: '-0.62px',
              color: 'var(--text-primary)',
              marginBottom: '16px'
            }}>
              Entre em
              <span style={{ color: 'var(--brand-primary)' }}> Contato</span>
            </h1>
            <p style={{
              fontSize: '20px',
              color: 'var(--text-secondary)',
              maxWidth: '700px',
              margin: '0 auto'
            }}>
              Escolha a melhor forma de falar com nossa equipe
            </p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))',
            gap: '40px',
            marginBottom: '60px'
          }}>
            {/* Instagram Card */}
            <a
              href="https://instagram.com/wolks.optimizer"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                textDecoration: 'none',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '12px',
                padding: '40px',
                transition: 'all 0.4s ease-in-out',
                display: 'block'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--brand-primary)';
                e.currentTarget.style.transform = 'translateY(-8px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-subtle)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <div style={{
                width: '80px',
                height: '80px',
                background: 'linear-gradient(135deg, #833AB4, #FD1D1D, #F77737)',
                borderRadius: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '24px'
              }}>
                <Instagram size={40} color="#fff" />
              </div>
              <h3 style={{
                fontSize: '28px',
                fontWeight: 600,
                color: 'var(--text-primary)',
                marginBottom: '8px'
              }}>
                Instagram
              </h3>
              <p style={{
                fontSize: '18px',
                color: 'var(--brand-primary)',
                marginBottom: '12px',
                fontWeight: 600
              }}>
                @wolks.optimizer
              </p>
              <p style={{
                fontSize: '16px',
                color: 'var(--text-secondary)',
                lineHeight: '1.6'
              }}>
                Veja depoimentos reais de clientes satisfeitos e acompanhe 
                nosso trabalho no dia a dia.
              </p>
            </a>

            {/* Twitter Card */}
            <a
              href="https://twitter.com/wolksoptimizer"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                textDecoration: 'none',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '12px',
                padding: '40px',
                transition: 'all 0.4s ease-in-out',
                display: 'block'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--brand-primary)';
                e.currentTarget.style.transform = 'translateY(-8px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-subtle)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <div style={{
                width: '80px',
                height: '80px',
                background: '#1DA1F2',
                borderRadius: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '24px'
              }}>
                <Twitter size={40} color="#fff" />
              </div>
              <h3 style={{
                fontSize: '28px',
                fontWeight: 600,
                color: 'var(--text-primary)',
                marginBottom: '8px'
              }}>
                Twitter
              </h3>
              <p style={{
                fontSize: '18px',
                color: 'var(--brand-primary)',
                marginBottom: '12px',
                fontWeight: 600
              }}>
                @wolksoptimizer
              </p>
              <p style={{
                fontSize: '16px',
                color: 'var(--text-secondary)',
                lineHeight: '1.6'
              }}>
                Novidades, dicas de otimização e atualizações sobre 
                nossos serviços.
              </p>
            </a>

            {/* Email Card */}
            <a
              href="mailto:dseronn@gmail.com"
              style={{
                textDecoration: 'none',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '12px',
                padding: '40px',
                transition: 'all 0.4s ease-in-out',
                display: 'block'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--brand-primary)';
                e.currentTarget.style.transform = 'translateY(-8px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-subtle)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <div style={{
                width: '80px',
                height: '80px',
                background: 'var(--brand-primary)',
                borderRadius: '16px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '24px'
              }}>
                <Mail size={40} color="#000" />
              </div>
              <h3 style={{
                fontSize: '28px',
                fontWeight: 600,
                color: 'var(--text-primary)',
                marginBottom: '8px'
              }}>
                Email
              </h3>
              <p style={{
                fontSize: '18px',
                color: 'var(--brand-primary)',
                marginBottom: '12px',
                fontWeight: 600
              }}>
                dseronn@gmail.com
              </p>
              <p style={{
                fontSize: '16px',
                color: 'var(--text-secondary)',
                lineHeight: '1.6'
              }}>
                Envie suas dúvidas por email e responderemos o mais 
                rápido possível.
              </p>
            </a>
          </div>

          {/* Quick Contact Button */}
          <div style={{
            textAlign: 'center',
            padding: '60px',
            background: 'var(--brand-hover)',
            border: '2px solid var(--brand-primary)',
            borderRadius: '12px',
            marginBottom: '60px'
          }}>
            <h2 style={{
              fontSize: '32px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '16px'
            }}>
              Prefere Escolher na Hora?
            </h2>
            <p style={{
              fontSize: '18px',
              color: 'var(--text-secondary)',
              marginBottom: '32px'
            }}>
              Clique no botão abaixo e escolha entre todas as opções de contato
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
                transition: 'all 0.4s ease-in-out'
              }}
              onMouseEnter={(e) => {
                e.target.style.background = '#FFFFFF';
                e.target.style.transform = 'scale(1.05)';
              }}
              onMouseLeave={(e) => {
                e.target.style.background = 'var(--brand-primary)';
                e.target.style.transform = 'scale(1)';
              }}
            >
              Ver Todas as Opções
            </button>
          </div>

          {/* Team Info */}
          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            padding: '60px'
          }}>
            <h2 style={{
              fontSize: '32px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '32px',
              textAlign: 'center'
            }}>
              Nossa Equipe
            </h2>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '40px'
            }}>
              <div style={{
                textAlign: 'center',
                padding: '32px',
                background: 'var(--bg-primary)',
                borderRadius: '12px',
                border: '1px solid var(--border-subtle)'
              }}>
                <div style={{
                  width: '120px',
                  height: '120px',
                  background: 'linear-gradient(135deg, var(--brand-primary), var(--brand-active))',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '48px',
                  fontWeight: 700,
                  color: '#000',
                  margin: '0 auto 24px'
                }}>
                  S
                </div>
                <h3 style={{
                  fontSize: '24px',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  marginBottom: '8px'
                }}>
                  Seron
                </h3>
                <p style={{
                  fontSize: '16px',
                  color: 'var(--brand-primary)',
                  marginBottom: '12px',
                  fontWeight: 600
                }}>
                  Especialista em Otimização
                </p>
                <p style={{
                  fontSize: '14px',
                  color: 'var(--text-secondary)',
                  lineHeight: '1.6'
                }}>
                  Responsável por toda a otimização técnica, 
                  BIOS, overclock e configuração do sistema.
                </p>
              </div>

              <div style={{
                textAlign: 'center',
                padding: '32px',
                background: 'var(--bg-primary)',
                borderRadius: '12px',
                border: '1px solid var(--border-subtle)'
              }}>
                <div style={{
                  width: '120px',
                  height: '120px',
                  background: 'linear-gradient(135deg, var(--brand-primary), var(--brand-active))',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '48px',
                  fontWeight: 700,
                  color: '#000',
                  margin: '0 auto 24px'
                }}>
                  S
                </div>
                <h3 style={{
                  fontSize: '24px',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  marginBottom: '8px'
                }}>
                  Stalks
                </h3>
                <p style={{
                  fontSize: '16px',
                  color: 'var(--brand-primary)',
                  marginBottom: '12px',
                  fontWeight: 600
                }}>
                  Gerente de Divulgação
                </p>
                <p style={{
                  fontSize: '14px',
                  color: 'var(--text-secondary)',
                  lineHeight: '1.6'
                }}>
                  Responsável pela comunicação, 
                  atendimento e divulgação dos serviços.
                </p>
              </div>
            </div>
          </div>

          {/* Additional Info */}
          <div style={{
            marginTop: '60px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
            gap: '32px'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '16px',
              padding: '24px',
              background: 'var(--bg-secondary)',
              borderRadius: '8px',
              border: '1px solid var(--border-subtle)'
            }}>
              <MapPin size={24} color="var(--brand-primary)" style={{ minWidth: '24px', marginTop: '4px' }} />
              <div>
                <h4 style={{
                  fontSize: '18px',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  marginBottom: '4px'
                }}>
                  Atendimento
                </h4>
                <p style={{
                  fontSize: '14px',
                  color: 'var(--text-secondary)'
                }}>
                  100% remoto via TeamViewer
                </p>
              </div>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '16px',
              padding: '24px',
              background: 'var(--bg-secondary)',
              borderRadius: '8px',
              border: '1px solid var(--border-subtle)'
            }}>
              <Clock size={24} color="var(--brand-primary)" style={{ minWidth: '24px', marginTop: '4px' }} />
              <div>
                <h4 style={{
                  fontSize: '18px',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  marginBottom: '4px'
                }}>
                  Resposta
                </h4>
                <p style={{
                  fontSize: '14px',
                  color: 'var(--text-secondary)'
                }}>
                  Responderemos o mais rápido possível
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <ContactModal isOpen={contactModalOpen} onClose={() => setContactModalOpen(false)} />
    </div>
  );
};

export default Contact;
