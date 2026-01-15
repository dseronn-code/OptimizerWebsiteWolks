import React, { useState } from 'react';
import { Check, ArrowRight } from 'lucide-react';
import ContactModal from '../components/ContactModal';

const Services = () => {
  const [contactModalOpen, setContactModalOpen] = useState(false);

  const services = [
    {
      name: 'Otimização Simples',
      description: 'Ideal para computadores de entrada',
      price: 'R$ 10',
      features: [
        'Remoção de programas que consomem desempenho',
        'Limpeza de arquivos temporários',
        'Otimização básica do Windows',
        'Desativação de serviços desnecessários',
        'Configuração de inicialização'
      ],
      details: 'Removemos apenas o que consome mais desempenho do computador, focando em otimizações de software que liberam recursos imediatamente.'
    },
    {
      name: 'Otimização Média',
      description: 'O mais popular - equilíbrio perfeito',
      price: 'R$ 20',
      featured: true,
      features: [
        'Tudo da Otimização Simples',
        'Configurações escondidas do Windows',
        'Otimização de rede e latência',
        'Ajustes avançados de performance',
        'Configuração de OBS para streaming',
        'Remoção completa de bloatware'
      ],
      details: 'Removemos tudo que consome desempenho, incluindo processos escondidos e configurações mínimas que fazem diferença. Otimização completa de software.'
    },
    {
      name: 'Otimização Avançada',
      description: 'Máximo desempenho possível',
      price: 'R$ 25',
      features: [
        'Tudo da Otimização Média',
        'Otimização completa da BIOS',
        'Overclock seguro e controlado',
        'Melhoria absurda de refrigeração',
        'Perfil salvo na placa-mãe',
        'Acompanhamento completo',
        'Suporte vitalício'
      ],
      details: 'Mesma coisa da Média, mas mexemos na BIOS onde a otimização é mais efetiva. Melhora absurdamente a refrigeração e performance do computador.'
    }
  ];

  return (
    <div style={{ background: 'var(--bg-primary)', minHeight: '100vh', paddingTop: '80px' }}>
      <section style={{ padding: '100px 7.6923%' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '60px' }}>
            <h1 style={{
              fontSize: '66px',
              fontWeight: 600,
              lineHeight: '1.1',
              letterSpacing: '-0.62px',
              color: 'var(--text-primary)',
              marginBottom: '16px'
            }}>
              Tipos de
              <span style={{ color: 'var(--brand-primary)' }}> Otimização</span>
            </h1>
            <p style={{
              fontSize: '20px',
              color: 'var(--text-secondary)',
              maxWidth: '700px',
              margin: '0 auto'
            }}>
              Escolha o nível de otimização ideal para seu computador e necessidades
            </p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))',
            gap: '40px',
            marginBottom: '80px'
          }}>
            {services.map((service, index) => (
              <div
                key={index}
                style={{
                  background: service.featured ? 'var(--brand-hover)' : 'var(--bg-secondary)',
                  border: service.featured ? '2px solid var(--brand-primary)' : '1px solid var(--border-subtle)',
                  borderRadius: '12px',
                  padding: '40px',
                  position: 'relative',
                  transition: 'all 0.4s ease-in-out'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-8px)';
                  e.currentTarget.style.borderColor = 'var(--brand-primary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  if (!service.featured) {
                    e.currentTarget.style.borderColor = 'var(--border-subtle)';
                  }
                }}
              >
                {service.featured && (
                  <div style={{
                    position: 'absolute',
                    top: '-12px',
                    right: '20px',
                    background: 'var(--brand-primary)',
                    color: '#000',
                    padding: '6px 16px',
                    borderRadius: '20px',
                    fontSize: '14px',
                    fontWeight: 600
                  }}>
                    Mais Popular
                  </div>
                )}

                <h3 style={{
                  fontSize: '28px',
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                  marginBottom: '8px'
                }}>
                  {service.name}
                </h3>
                <p style={{
                  fontSize: '16px',
                  color: 'var(--text-secondary)',
                  marginBottom: '20px'
                }}>
                  {service.description}
                </p>
                <div style={{
                  fontSize: '42px',
                  fontWeight: 700,
                  color: 'var(--brand-primary)',
                  marginBottom: '8px'
                }}>
                  {service.price}
                </div>
                <p style={{
                  fontSize: '14px',
                  color: 'var(--text-muted)',
                  marginBottom: '24px'
                }}>
                  Dividido obrigatoriamente em 2x
                </p>

                <div style={{
                  background: 'var(--bg-primary)',
                  padding: '20px',
                  borderRadius: '8px',
                  marginBottom: '24px'
                }}>
                  <p style={{
                    fontSize: '14px',
                    color: 'var(--text-secondary)',
                    lineHeight: '1.6'
                  }}>
                    {service.details}
                  </p>
                </div>

                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  marginBottom: '32px'
                }}>
                  {service.features.map((feature, fIndex) => (
                    <div key={fIndex} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                      <div style={{
                        minWidth: '20px',
                        minHeight: '20px',
                        background: 'var(--brand-primary)',
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginTop: '2px'
                      }}>
                        <Check size={14} color="#000" />
                      </div>
                      <span style={{
                        fontSize: '16px',
                        color: 'var(--text-primary)',
                        lineHeight: '1.4'
                      }}>
                        {feature}
                      </span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => setContactModalOpen(true)}
                  style={{
                    width: '100%',
                    background: service.featured ? 'var(--brand-primary)' : 'rgba(255, 255, 255, 0.1)',
                    color: service.featured ? '#000000' : '#FFFFFF',
                    border: 'none',
                    borderRadius: '0px',
                    padding: '16px 24px',
                    fontSize: '16px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.4s ease-in-out',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                  }}
                  onMouseEnter={(e) => {
                    if (service.featured) {
                      e.target.style.background = '#FFFFFF';
                    } else {
                      e.target.style.background = 'var(--brand-primary)';
                      e.target.style.color = '#000000';
                    }
                    e.target.style.transform = 'scale(1.02)';
                  }}
                  onMouseLeave={(e) => {
                    if (service.featured) {
                      e.target.style.background = 'var(--brand-primary)';
                    } else {
                      e.target.style.background = 'rgba(255, 255, 255, 0.1)';
                      e.target.style.color = '#FFFFFF';
                    }
                    e.target.style.transform = 'scale(1)';
                  }}
                >
                  Adquirir Agora
                  <ArrowRight size={18} />
                </button>
              </div>
            ))}
          </div>

          {/* What's Included Section */}
          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px',
            padding: '60px',
            marginTop: '60px'
          }}>
            <h2 style={{
              fontSize: '32px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '24px',
              textAlign: 'center'
            }}>
              Todas as Otimizações Incluem
            </h2>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
              gap: '24px',
              marginTop: '40px'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px'
              }}>
                <Check size={24} color="var(--brand-primary)" style={{ minWidth: '24px', marginTop: '2px' }} />
                <div>
                  <h4 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                    Acompanhamento Total
                  </h4>
                  <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                    Você assiste tudo em tempo real
                  </p>
                </div>
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px'
              }}>
                <Check size={24} color="var(--brand-primary)" style={{ minWidth: '24px', marginTop: '2px' }} />
                <div>
                  <h4 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                    Duração: 1h30 a 3h
                  </h4>
                  <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                    Processo completo e detalhado
                  </p>
                </div>
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '12px'
              }}>
                <Check size={24} color="var(--brand-primary)" style={{ minWidth: '24px', marginTop: '2px' }} />
                <div>
                  <h4 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                    Via TeamViewer
                  </h4>
                  <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                    Acesso remoto seguro e controlado
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <ContactModal isOpen={contactModalOpen} onClose={() => setContactModalOpen(false)} />
    </div>
  );
};

export default Services;
