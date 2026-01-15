import React from 'react';
import { Instagram, Twitter, Mail, X } from 'lucide-react';

const ContactModal = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.8)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-medium)',
          borderRadius: '12px',
          padding: '40px',
          maxWidth: '500px',
          width: '100%',
          position: 'relative'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: '8px',
            transition: 'color 0.3s ease'
          }}
          onMouseEnter={(e) => e.target.style.color = 'var(--text-primary)'}
          onMouseLeave={(e) => e.target.style.color = 'var(--text-muted)'}
        >
          <X size={24} />
        </button>

        <h2 style={{
          fontSize: '32px',
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: '8px',
          letterSpacing: '-0.02em'
        }}>
          Fale Conosco
        </h2>
        <p style={{
          fontSize: '16px',
          color: 'var(--text-secondary)',
          marginBottom: '32px'
        }}>
          Escolha a melhor forma de entrar em contato
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <a
            href="https://instagram.com/wolks.optimizer"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              padding: '20px',
              background: 'var(--bg-overlay)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              textDecoration: 'none',
              color: 'var(--text-primary)',
              transition: 'all 0.3s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--brand-hover)';
              e.currentTarget.style.borderColor = 'var(--brand-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-overlay)';
              e.currentTarget.style.borderColor = 'var(--border-subtle)';
            }}
          >
            <div style={{
              width: '48px',
              height: '48px',
              background: 'linear-gradient(135deg, #833AB4, #FD1D1D, #F77737)',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Instagram size={24} color="#fff" />
            </div>
            <div>
              <div style={{ fontSize: '18px', fontWeight: 600, marginBottom: '4px' }}>
                Instagram
              </div>
              <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                @wolks.optimizer
              </div>
            </div>
          </a>

          <a
            href="https://twitter.com/wolksoptimizer"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              padding: '20px',
              background: 'var(--bg-overlay)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              textDecoration: 'none',
              color: 'var(--text-primary)',
              transition: 'all 0.3s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--brand-hover)';
              e.currentTarget.style.borderColor = 'var(--brand-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-overlay)';
              e.currentTarget.style.borderColor = 'var(--border-subtle)';
            }}
          >
            <div style={{
              width: '48px',
              height: '48px',
              background: '#1DA1F2',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Twitter size={24} color="#fff" />
            </div>
            <div>
              <div style={{ fontSize: '18px', fontWeight: 600, marginBottom: '4px' }}>
                Twitter
              </div>
              <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                @wolksoptimizer
              </div>
            </div>
          </a>

          <a
            href="mailto:dseronn@gmail.com"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '16px',
              padding: '20px',
              background: 'var(--bg-overlay)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              textDecoration: 'none',
              color: 'var(--text-primary)',
              transition: 'all 0.3s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--brand-hover)';
              e.currentTarget.style.borderColor = 'var(--brand-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--bg-overlay)';
              e.currentTarget.style.borderColor = 'var(--border-subtle)';
            }}
          >
            <div style={{
              width: '48px',
              height: '48px',
              background: 'var(--brand-primary)',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Mail size={24} color="#000" />
            </div>
            <div>
              <div style={{ fontSize: '18px', fontWeight: 600, marginBottom: '4px' }}>
                Email
              </div>
              <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>
                dseronn@gmail.com
              </div>
            </div>
          </a>
        </div>
      </div>
    </div>
  );
};

export default ContactModal;
