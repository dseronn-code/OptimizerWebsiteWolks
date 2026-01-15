# Wolks Optimizer - Product Requirements Document

## Original Problem Statement
Criar um website profissional para Wolks Optimizer, empresa de otimização de computadores. O site deve apresentar 3 tipos de otimização (Simples, Média e Avançada), explicar como funciona, listar requisitos e limitações, e fornecer formas de contato.

**Requisitos do Cliente:**
- Design moderno com tema dark (azul escuro, branco e preto)
- Múltiplas páginas (não single page)
- Sistema de contato direto (sem checkout pago)
- Animações 3D interativas
- Informações detalhadas sobre cada tipo de otimização
- Seções sobre requisitos e processo passo a passo
- Formas de contato: Instagram (@wolks.optimizer), Twitter (@wolksoptimizer), Email (d.seronn@gmail.com)
- Preço: R$ 260,00 dividido em 2x

## User Personas

### Persona 1: Gamer Competitivo
- **Idade:** 16-25 anos
- **Objetivo:** Melhorar FPS e reduzir latência em jogos competitivos (Fortnite, Valorant, CS:GO)
- **Pain Point:** PC com performance instável, baixo FPS
- **Expectativa:** Ganhos reais e mensuráveis de performance

### Persona 2: Streamer/Criador de Conteúdo
- **Idade:** 20-30 anos
- **Objetivo:** Melhorar performance de streaming e renderização
- **Pain Point:** Travamentos durante lives, renderização lenta
- **Expectativa:** Sistema mais estável e rápido

### Persona 3: Profissional/Editor
- **Idade:** 25-40 anos
- **Objetivo:** Aumentar produtividade em programas de edição
- **Pain Point:** Lentidão em softwares pesados (Premiere, Photoshop, Blender)
- **Expectativa:** Workflow mais ágil

## Architecture & Tech Stack

### Frontend
- **Framework:** React 19
- **Routing:** React Router DOM 7.5.1
- **UI Library:** Shadcn UI + Lucide React (ícones)
- **3D Graphics:** Spline (@splinetool/react-spline 4.1.0)
- **Styling:** Tailwind CSS + CSS Variables (tema dark personalizado)
- **Build Tool:** Create React App com Craco

### Design System
- **Color Palette:**
  - Background Primary: #000000 (preto puro)
  - Background Secondary: #121212 (cinza muito escuro)
  - Brand Primary: #00FFD1 (ciano-verde neon)
  - Text Primary: #FFFFFF
  - Text Secondary: rgba(255, 255, 255, 0.85)
  - Text Muted: #4D4D4D

- **Typography:**
  - Font Family: 'Inter', system-ui
  - Headings: 66px (display), 48px (h1), 32px (h2), 24px (h3)
  - Body: 20px (large), 18px (medium), 16px (small)

- **Components:** Sharp corners (border-radius: 0px) para botões primários, tema cyberpunk/tech

## What's Been Implemented (Janeiro 15, 2025)

### ✅ Completed Features

#### 1. Core Pages Structure
- [x] **Home Page (`/`)** - Hero section com 3D Spline, benefícios, CTA sections
- [x] **Services Page (`/servicos`)** - Cards detalhados dos 3 tipos de otimização
- [x] **Requirements Page (`/requisitos`)** - Lista de computadores não elegíveis
- [x] **Process Page (`/processo`)** - Timeline com 8 passos do processo
- [x] **Contact Page (`/contato`)** - Múltiplas formas de contato + informações da equipe

#### 2. Components
- [x] **Header** - Fixed navbar com logo, navegação e menu mobile
- [x] **Footer** - Links rápidos, redes sociais, informações de copyright
- [x] **ContactModal** - Modal elegante com opções de Instagram, Twitter e Email

#### 3. Design & Interactions
- [x] Dark theme profissional com cor ciano-verde (#00FFD1)
- [x] Animações 3D Spline (bola de neon interativa)
- [x] Hover states em todos os elementos interativos
- [x] Transições suaves (0.4s ease-in-out)
- [x] Responsividade para mobile, tablet e desktop
- [x] Custom scrollbar com cor da brand
- [x] Sharp corners nos botões (design cyberpunk)

#### 4. Content
- [x] Informações completas sobre os 3 tipos de otimização
- [x] Lista de computadores não suportados (10 itens)
- [x] Processo detalhado em 8 passos
- [x] Informações de pagamento e preço
- [x] Seção sobre a equipe (Seron e Stalks)
- [x] Múltiplos CTAs estrategicamente posicionados

#### 5. User Experience
- [x] Modal de contato com opções de Instagram, Twitter e Email
- [x] Links diretos para redes sociais (target="_blank")
- [x] Navegação intuitiva entre páginas
- [x] Active states na navegação
- [x] Menu mobile funcional
- [x] Smooth scrolling

## Tech Details

### Dependencies Installed
```json
{
  "@splinetool/react-spline": "4.1.0",
  "@splinetool/runtime": "1.12.35",
  "lucide-react": "0.507.0",
  "react-router-dom": "7.5.1"
}
```

### File Structure
```
/app/frontend/src/
├── App.js (main router)
├── App.css (dark theme variables)
├── index.css (tailwind + custom styles)
├── components/
│   ├── Header.jsx
│   ├── Footer.jsx
│   └── ContactModal.jsx
└── pages/
    ├── Home.jsx (hero + 3D spline)
    ├── Services.jsx (3 tipos de otimização)
    ├── Requirements.jsx (limitações)
    ├── Process.jsx (8 passos)
    └── Contact.jsx (formas de contato)
```

## Prioritized Backlog

### P0 (Essencial - Não Implementado)
- [ ] N/A - Todas as funcionalidades essenciais foram implementadas

### P1 (Alta Prioridade - Melhorias)
- [ ] Adicionar seção de depoimentos/testemunhos de clientes
- [ ] Implementar galeria de "Antes e Depois" (quando houver material)
- [ ] Adicionar FAQ section com perguntas comuns
- [ ] Implementar WhatsApp Business integration
- [ ] SEO optimization (meta tags, Open Graph, structured data)

### P2 (Média Prioridade - Enhancements)
- [ ] Blog/articles sobre otimização de PC
- [ ] Calculadora de potencial de ganho de FPS
- [ ] Vídeos explicativos embarcados
- [ ] Comparador de tipos de otimização
- [ ] Sistema de agendamento online

### P3 (Baixa Prioridade - Nice to Have)
- [ ] Dark/Light mode toggle
- [ ] Animações de entrada nos elementos
- [ ] Loading states mais elaborados
- [ ] Easter eggs interativos
- [ ] Multilingual support (EN/PT)

## Next Action Items

### Immediate Next Steps:
1. **User Testing** - Solicitar feedback do cliente sobre design e conteúdo
2. **Content Review** - Validar se todas as informações estão corretas e completas
3. **Mobile Testing** - Testar extensivamente em diferentes tamanhos de tela
4. **Performance** - Otimizar carregamento da animação 3D Spline
5. **Deploy** - Preparar para deploy em produção

### Future Enhancements (Based on User Feedback):
- Adicionar sistema de checkout se cliente decidir implementar pagamento online
- Integrar com CRM para gerenciar leads
- Adicionar analytics (Google Analytics/Hotjar)
- Implementar chat ao vivo
- Criar landing pages específicas para cada tipo de otimização

## Business Goals

### Primary Goal
Converter visitantes em clientes através de comunicação clara dos benefícios e processo transparente.

### Success Metrics (To Be Implemented)
- Taxa de conversão (visitantes → contatos)
- Taxa de bounce por página
- Tempo médio no site
- Páginas mais visitadas
- CTAs mais clicados

### Revenue Model
- Serviço: R$ 260,00 por otimização
- Pagamento: 2x sem juros via PIX
- 50% ao agendar + 50% no dia do serviço
- Modelo vitalício (não recorrente)

## Design Decisions

### Why Dark Theme?
- Alinha com público-alvo (gamers, tech enthusiasts)
- Visual moderno e profissional
- Destaca a cor da brand (#00FFD1)
- Reduz cansaço visual

### Why Spline 3D?
- Diferenciação visual forte
- Interatividade aumenta engagement
- Alinha com tema tech/cyberpunk
- WOW factor para primeira impressão

### Why Multiple Pages?
- Melhor SEO (cada página otimizada para keywords específicas)
- Usuário não precisa "scroll infinito"
- Organização clara de conteúdo
- Facilita navegação direta para informação específica

### Why No Checkout System?
- Cliente prefere contato direto personalizado
- Avaliação individual de cada caso (requisitos)
- Construção de relacionamento antes da venda
- Flexibilidade no processo de pagamento

## Notes & Observations

### Technical Notes:
- Spline scene URL: `https://prod.spline.design/NbVmy6DPLhY-5Lvg/scene.splinecode`
- Sem integração com backend (não necessário nesta fase)
- Website 100% frontend (static site)
- Pode ser hospedado em Vercel, Netlify ou similar

### Content Notes:
- Todo conteúdo em português (BR)
- Tom profissional mas acessível
- Enfatiza transparência (mostra limitações)
- Foco em educação do cliente

### Design Notes:
- Seguiu green-dark-theme playbook
- Limitação de cores: apenas brand color em botões/accents
- 90/10 rule: 90% preto/escuro, 10% cor
- Sharp corners para estética tech/cyberpunk

## Changelog

### 2025-01-15 - MVP Complete
- ✅ Criado estrutura completa de 5 páginas
- ✅ Implementado tema dark profissional
- ✅ Integrado Spline 3D na home
- ✅ Criado sistema de navegação responsivo
- ✅ Implementado modal de contato
- ✅ Adicionado todas as informações de serviço
- ✅ Testado e validado em desktop
- 🎯 Status: **Ready for Client Review**
