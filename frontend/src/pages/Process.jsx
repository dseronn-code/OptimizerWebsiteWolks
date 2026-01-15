import React, { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import ContactModal from '../components/ContactModal';

const Process = () => {
  const [contactModalOpen, setContactModalOpen] = useState(false);

  const steps = [
    {
      number: '01',
      title: 'Preparação do Pendrive',
      description: 'Você prepara um pendrive (mínimo 8GB) seguindo as instruções do vídeo que enviaremos. Este passo é CRUCIAL para o sucesso da otimização.',
      highlight: 'Importante: Use apenas o método que ensinaremos no vídeo'
    },
    {
      number: '02',
      title: 'Comunicação via WhatsApp',
      description: 'No dia agendado, enviaremos nosso WhatsApp comercial onde nos comunicaremos durante todo o processo.',
      highlight: 'Você terá suporte completo em tempo real'
    },
    {
      number: '03',
      title: 'Análise Inicial',
      description: 'Entramos em seu PC via TeamViewer para monitorar frequências, voltagens e temperaturas atuais. Identificamos o potencial de melhoria.',
      highlight: 'Diagnóstico completo do sistema'
    },
    {
      number: '04',
      title: 'Atualização da BIOS',
      description: 'Em chamada de vídeo, atualizamos sua BIOS para a versão mais recente. Isso garante melhorias de performance e correções de instabilidades.',
      highlight: 'Você acompanha tudo em tempo real'
    },
    {
      number: '05',
      title: 'Otimização da BIOS',
      description: 'Desabilitamos configurações de economia de energia e recursos desnecessários. Fazemos overclock seguro que deixa seu PC mais FRIO e estável.',
      highlight: 'Configurações permanentes salvas na placa-mãe'
    },
    {
      number: '06',
      title: 'Formatação e Instalação',
      description: 'Usando o pendrive que você preparou, formatamos e instalamos um Windows modificado e otimizado por nós, baseado no sistema limpo da Microsoft.',
      highlight: 'ATENÇÃO: Faça backup antes - todos os dados serão apagados'
    },
    {
      number: '07',
      title: 'Otimização do Windows',
      description: 'Configuramos o Windows para reconhecer perfeitamente as otimizações da BIOS. Removemos bloatware e ajustamos o sistema para máxima performance.',
      highlight: 'Sistema totalmente limpo e otimizado'
    },
    {
      number: '08',
      title: 'Finalização e Orientações',
      description: 'Testamos tudo, configuramos o OBS (se necessário) e passamos as regras de manutenção. Recomendamos upgrades se identificarmos gargalos.',
      highlight: 'PC pronto para jogar/trabalhar imediatamente'
    }
  ];

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
              Como Funciona o
              <span style={{ color: 'var(--brand-primary)' }}> Processo</span>
            </h1>
            <p style={{
              fontSize: '20px',
              color: 'var(--text-secondary)',
              maxWidth: '700px',
              margin: '0 auto'
            }}>
              Passo a passo completo da otimização. Duração média: 1h30 a 3h
            </p>
          </div>

          {/* Timeline */}
          <div style={{ position: 'relative' }}>
            {/* Vertical Line */}
            <div style={{
              position: 'absolute',
              left: '40px',
              top: '20px',
              bottom: '20px',
              width: '2px',
              background: 'linear-gradient(to bottom, var(--brand-primary), var(--brand-active))',
              display: 'none'
            }} className="timeline-line" />

            <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
              {steps.map((step, index) => (
                <div
                  key={index}
                  style={{
                    display: 'flex',
                    gap: '32px',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: '12px',
                    padding: '40px',
                    position: 'relative',
                    transition: 'all 0.4s ease-in-out'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--brand-primary)';
                    e.currentTarget.style.transform = 'translateX(8px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-subtle)';
                    e.currentTarget.style.transform = 'translateX(0)';
                  }}
                >
                  <div style={{
                    minWidth: '80px',
                    height: '80px',
                    background: 'linear-gradient(135deg, var(--brand-primary), var(--brand-active))',
                    borderRadius: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '32px',
                    fontWeight: 700,
                    color: '#000',
                    boxShadow: '0 8px 24px rgba(0, 255, 209, 0.3)'
                  }}>
                    {step.number}
                  </div>

                  <div style={{ flex: 1 }}>
                    <h3 style={{
                      fontSize: '24px',
                      fontWeight: 600,
                      color: 'var(--text-primary)',
                      marginBottom: '12px'
                    }}>
                      {step.title}
                    </h3>
                    <p style={{
                      fontSize: '16px',
                      color: 'var(--text-secondary)',
                      lineHeight: '1.6',
                      marginBottom: '16px'
                    }}>
                      {step.description}
                    </p>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '12px 16px',
                      background: 'var(--brand-hover)',
                      border: '1px solid var(--brand-primary)',
                      borderRadius: '8px'
                    }}>
                      <CheckCircle2 size={20} color="var(--brand-primary)" />
                      <span style={{
                        fontSize: '14px',
                        fontWeight: 600,
                        color: 'var(--brand-primary)'
                      }}>
                        {step.highlight}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Important Notes */}
          <div style={{
            marginTop: '80px',
            background: 'var(--bg-secondary)',
            border: '2px solid var(--brand-primary)',
            borderRadius: '12px',
            padding: '40px'
          }}>
            <h2 style={{
              fontSize: '32px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '24px',
              textAlign: 'center'
            }}>
              Informações Importantes
            </h2>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '32px',
              marginTop: '32px'
            }}>
              <div>
                <h4 style={{
                  fontSize: '20px',
                  fontWeight: 600,
                  color: 'var(--brand-primary)',
                  marginBottom: '12px'
                }}>
                  Duração
                </h4>
                <p style={{
                  fontSize: '16px',
                  color: 'var(--text-secondary)',
                  lineHeight: '1.6'
                }}>
                  O processo completo leva entre 1h30 e 3h, dependendo da complexidade 
                  do seu hardware e velocidade de internet.
                </p>
              </div>
              <div>
                <h4 style={{
                  fontSize: '20px',
                  fontWeight: 600,
                  color: 'var(--brand-primary)',
                  marginBottom: '12px'
                }}>
                  Permanência
                </h4>
                <p style={{
                  fontSize: '16px',
                  color: 'var(--text-secondary)',
                  lineHeight: '1.6'
                }}>
                  Todas as configurações da BIOS são salvas em um perfil permanente 
                  na memória da placa-mãe. Mesmo após reset, você pode restaurá-lo.
                </p>
              </div>
              <div>
                <h4 style={{
                  fontSize: '20px',
                  fontWeight: 600,
                  color: 'var(--brand-primary)',
                  marginBottom: '12px'
                }}>
                  Segurança
                </h4>
                <p style={{
                  fontSize: '16px',
                  color: 'var(--text-secondary)',
                  lineHeight: '1.6'
                }}>
                  Todo o overclock é feito de forma segura, REDUZINDO as temperaturas 
                  e aumentando a vida útil do processador.
                </p>
              </div>
            </div>
          </div>

          {/* Payment Info */}
          <div style={{
            marginTop: '60px',
            padding: '40px',
            background: 'var(--bg-secondary)',
            borderRadius: '12px',
            border: '1px solid var(--border-subtle)'
          }}>
            <h3 style={{
              fontSize: '28px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '20px'
            }}>
              Pagamento e Garantia
            </h3>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
              gap: '24px'
            }}>
              <div style={{
                padding: '24px',
                background: 'var(--bg-primary)',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)'
              }}>
                <div style={{
                  fontSize: '32px',
                  fontWeight: 700,
                  color: 'var(--brand-primary)',
                  marginBottom: '8px'
                }}>
                  R$ 260
                </div>
                <div style={{
                  fontSize: '16px',
                  color: 'var(--text-secondary)'
                }}>
                  Total do serviço
                </div>
              </div>
              <div style={{
                padding: '24px',
                background: 'var(--bg-primary)',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)'
              }}>
                <div style={{
                  fontSize: '32px',
                  fontWeight: 700,
                  color: 'var(--brand-primary)',
                  marginBottom: '8px'
                }}>
                  2x
                </div>
                <div style={{
                  fontSize: '16px',
                  color: 'var(--text-secondary)'
                }}>
                  Sem juros via PIX
                </div>
              </div>
              <div style={{
                padding: '24px',
                background: 'var(--bg-primary)',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)'
              }}>
                <div style={{
                  fontSize: '32px',
                  fontWeight: 700,
                  color: 'var(--brand-primary)',
                  marginBottom: '8px'
                }}>
                  50%
                </div>
                <div style={{
                  fontSize: '16px',
                  color: 'var(--text-secondary)'
                }}>
                  Pago ao agendar
                </div>
              </div>
              <div style={{
                padding: '24px',
                background: 'var(--bg-primary)',
                borderRadius: '8px',
                border: '1px solid var(--border-subtle)'
              }}>
                <div style={{
                  fontSize: '32px',
                  fontWeight: 700,
                  color: 'var(--brand-primary)',
                  marginBottom: '8px'
                }}>
                  50%
                </div>
                <div style={{
                  fontSize: '16px',
                  color: 'var(--text-secondary)'
                }}>
                  No dia da otimização
                </div>
              </div>
            </div>
            <p style={{
              fontSize: '14px',
              color: 'var(--text-muted)',
              marginTop: '24px',
              textAlign: 'center'
            }}>
              Aceitamos PIX, Cartão de Crédito (MercadoPago), Wise (internacional) e transferência bancária
            </p>
          </div>

          {/* CTA */}
          <div style={{
            marginTop: '60px',
            textAlign: 'center',
            padding: '60px',
            background: 'var(--brand-hover)',
            border: '2px solid var(--brand-primary)',
            borderRadius: '12px'
          }}>
            <h3 style={{
              fontSize: '32px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '16px'
            }}>
              Pronto para Começar?
            </h3>
            <p style={{
              fontSize: '18px',
              color: 'var(--text-secondary)',
              marginBottom: '32px',
              maxWidth: '600px',
              margin: '0 auto 32px'
            }}>
              Entre em contato para tirar dúvidas e agendar sua otimização
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
              Fale Conosco Agora
            </button>
          </div>
        </div>
      </section>

      <ContactModal isOpen={contactModalOpen} onClose={() => setContactModalOpen(false)} />

      <style>{`
        @media (min-width: 768px) {
          .timeline-line {
            display: block !important;
          }
        }
      `}</style>
    </div>
  );
};

export default Process;
