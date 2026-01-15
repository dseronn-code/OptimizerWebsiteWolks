import React, { useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import ContactModal from '../components/ContactModal';

const Requirements = () => {
  const [contactModalOpen, setContactModalOpen] = useState(false);

  const notSupported = [
    'Notebooks (ganhos não significativos)',
    'Desktops com processadores Xeon',
    'Desktops com Intel i3 de 9ª geração ou inferior',
    'Desktops com processadores Intel de 4ª geração ou inferior',
    'Desktops com placas-mãe modelo H61',
    'Desktops com placas-mãe modelo H310',
    'Desktops com placas-mãe SOYO, GALAX e GOLINE',
    'Desktops com placas-mãe Interposer (processador soldado)',
    'Desktops da Alienware (Ex: Aurora R15)',
    'Desktops que não possuam SSD'
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
              Requisitos e
              <span style={{ color: 'var(--brand-primary)' }}> Limitações</span>
            </h1>
            <p style={{
              fontSize: '20px',
              color: 'var(--text-secondary)',
              maxWidth: '700px',
              margin: '0 auto'
            }}>
              Para garantir resultados significativos, alguns computadores não são elegíveis
            </p>
          </div>

          {/* Warning Box */}
          <div style={{
            background: 'rgba(255, 165, 0, 0.1)',
            border: '2px solid rgba(255, 165, 0, 0.5)',
            borderRadius: '12px',
            padding: '32px',
            marginBottom: '60px',
            display: 'flex',
            gap: '20px',
            alignItems: 'flex-start'
          }}>
            <AlertTriangle size={32} color="#FFA500" style={{ minWidth: '32px', marginTop: '4px' }} />
            <div>
              <h3 style={{
                fontSize: '24px',
                fontWeight: 600,
                color: '#FFA500',
                marginBottom: '12px'
              }}>
                Importante: Leia com Atenção
              </h3>
              <p style={{
                fontSize: '16px',
                color: 'var(--text-secondary)',
                lineHeight: '1.6'
              }}>
                Se o seu computador se enquadra em alguma das configurações abaixo, 
                recomendamos que invista mais em seu setup ao invés de contratar qualquer 
                tipo de otimização. Os ganhos não serão tão significativos quanto em 
                desktops que atendem aos requisitos ideais.
              </p>
            </div>
          </div>

          {/* Not Supported List */}
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
              NÃO Fazemos Otimização em:
            </h2>

            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
              gap: '20px'
            }}>
              {notSupported.map((item, index) => (
                <div
                  key={index}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '16px',
                    background: 'var(--bg-primary)',
                    padding: '20px',
                    borderRadius: '8px',
                    border: '1px solid var(--border-subtle)',
                    transition: 'all 0.3s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(255, 100, 100, 0.5)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-subtle)';
                  }}
                >
                  <div style={{
                    minWidth: '28px',
                    minHeight: '28px',
                    background: 'rgba(255, 100, 100, 0.2)',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginTop: '2px'
                  }}>
                    <X size={18} color="#ff6464" />
                  </div>
                  <span style={{
                    fontSize: '16px',
                    color: 'var(--text-primary)',
                    lineHeight: '1.6'
                  }}>
                    {item}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Why These Limitations */}
          <div style={{
            marginTop: '60px',
            padding: '40px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '12px'
          }}>
            <h3 style={{
              fontSize: '28px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '20px'
            }}>
              Por Que Essas Limitações?
            </h3>
            <p style={{
              fontSize: '18px',
              color: 'var(--text-secondary)',
              lineHeight: '1.6',
              marginBottom: '16px'
            }}>
              Nossa prioridade é garantir que você tenha uma experiência completa e positiva. 
              Computadores que se enquadram nas limitações acima têm restrições de hardware 
              que impedem ganhos significativos de performance através de otimização de software 
              e BIOS.
            </p>
            <p style={{
              fontSize: '18px',
              color: 'var(--text-secondary)',
              lineHeight: '1.6'
            }}>
              <strong style={{ color: 'var(--brand-primary)' }}>Nossa recomendação:</strong> Invista 
              primeiro em upgrades de hardware essenciais (SSD, mais RAM, melhor processador) antes 
              de considerar otimização. Assim você terá resultados muito melhores!
            </p>
          </div>

          {/* What You Need */}
          <div style={{
            marginTop: '60px',
            padding: '40px',
            background: 'var(--brand-hover)',
            border: '2px solid var(--brand-primary)',
            borderRadius: '12px'
          }}>
            <h3 style={{
              fontSize: '28px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '20px'
            }}>
              O Que Você Precisa Ter
            </h3>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
              gap: '20px',
              marginTop: '24px'
            }}>
              <div>
                <h4 style={{
                  fontSize: '20px',
                  fontWeight: 600,
                  color: 'var(--brand-primary)',
                  marginBottom: '8px'
                }}>
                  1. Pendrive (8GB mínimo)
                </h4>
                <p style={{
                  fontSize: '16px',
                  color: 'var(--text-secondary)'
                }}>
                  Um pendrive de qualidade que você tenha disponível
                </p>
              </div>
              <div>
                <h4 style={{
                  fontSize: '20px',
                  fontWeight: 600,
                  color: 'var(--brand-primary)',
                  marginBottom: '8px'
                }}>
                  2. TeamViewer Instalado
                </h4>
                <p style={{
                  fontSize: '16px',
                  color: 'var(--text-secondary)'
                }}>
                  Para acesso remoto seguro durante o processo
                </p>
              </div>
              <div>
                <h4 style={{
                  fontSize: '20px',
                  fontWeight: 600,
                  color: 'var(--brand-primary)',
                  marginBottom: '8px'
                }}>
                  3. Backup de Arquivos
                </h4>
                <p style={{
                  fontSize: '16px',
                  color: 'var(--text-secondary)'
                }}>
                  A formatação apagará todos os dados do SSD/HD
                </p>
              </div>
            </div>
          </div>

          {/* CTA */}
          <div style={{
            marginTop: '60px',
            textAlign: 'center',
            padding: '40px',
            background: 'var(--bg-secondary)',
            borderRadius: '12px'
          }}>
            <h3 style={{
              fontSize: '28px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: '16px'
            }}>
              Seu PC Atende aos Requisitos?
            </h3>
            <p style={{
              fontSize: '18px',
              color: 'var(--text-secondary)',
              marginBottom: '32px'
            }}>
              Entre em contato e tire suas dúvidas antes de adquirir
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
              Fale Conosco
            </button>
          </div>
        </div>
      </section>

      <ContactModal isOpen={contactModalOpen} onClose={() => setContactModalOpen(false)} />
    </div>
  );
};

export default Requirements;
