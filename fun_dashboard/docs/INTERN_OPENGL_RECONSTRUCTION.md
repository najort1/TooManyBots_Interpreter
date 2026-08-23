# Reconstrução Gráfica do Jogo do Estagiário em OpenGL / WebGL2

## 1. Visão Geral e Objetivo
O mini-game do cargo **Estagiário** (`printer`) foi completamente reconstruído utilizando **OpenGL ES 3.0 / WebGL2** com gráficos 3D modernos em tempo real, iluminação dinâmica, shaders GLSL de alta fidelidade, sistema de partículas e interações modernas.

Todo o **loop de gameplay, regras de balanceamento, curva de dificuldade, limites de erros e contratos de API com o backend** foram rigorosamente preservados.

---

## 2. Arquitetura da Solução

### 2.1 Separação Rígida de Camadas
- **Camada de Renderização Gráfica (OpenGL / WebGL2 3D)**:
  - Implementada em `fun_dashboard/src/components/intern/`.
  - Shaders GLSL 3.00 es compilados nativamente no hardware.
  - Geometrias procedurais com VBOs/VAOs nativos (sem overhead de assets externos pesados).
  - Áudio procedural em tempo real com Web Audio API (`soundEngine.ts`).
- **Camada de Lógica & Persistência (Backend Node.js & SQLite)**:
  - Módulo `fun/` (`fun/jobs/catalog.js`, `fun/services/jobService.js`, `fun/jobs/token.js`).
  - Endpoints `/api/fun/job/open`, `/api/fun/job/finish` e `/api/fun/job/practice/*`.
  - Zero alterações na lógica de negócio e regras de validação.

### 2.2 Componentes e Módulos Gráficos Criados
1. `fun_dashboard/src/components/intern/glMath.ts`:
   - Biblioteca de álgebra linear 3D pura (vetores `vec3`, `vec4`, matrizes 4x4 `mat4`, rotações, projeção perspectiva, câmera lookAt, interpolações lerp).
2. `fun_dashboard/src/components/intern/glShaders.ts`:
   - Shaders GLSL 3.00 es (`MAIN_VS` e `MAIN_FS`) com modelo Phong / Blinn-Specular.
   - Suporte a múltiplas fontes de luz:
     - **Luz Direcional Solar (Key Light)** com atenuação e specular.
     - **Scanner Laser Point Light** dinâmica com atenuação quadrática e cor turquesa.
     - **Status LED Light** frontal (feedback visual verde de aprovação / vermelho de advertência).
     - Componentes emissivos e efeito de scanline.
   - Shaders de partículas 3D (`PARTICLE_VS` e `PARTICLE_FS`) com suavização radial e alpha fading.
3. `fun_dashboard/src/components/intern/glGeometry.ts`:
   - Construtor de malhas (`GeometryBuilder`) e gerenciador de VBOs/VAOs/EBOs (`GlMesh`).
4. `fun_dashboard/src/components/intern/glSceneMeshes.ts`:
   - Cenário 3D corporativo:
     - Sala executiva com piso de carpete, tapete e painel acústico ripado de madeira nobre.
     - Mesa executiva com tampo em madeira escura, borda chanfrada, pés metálicos e gaveteiro com puxadores cromados.
     - Estação de trabalho com multifuncional corporativa moderna, vidro de scanner, painel frontal LCD e botões iluminados.
     - Feixe laser volumétrico para o leitor de documentos.
     - Carimbo mecânico 3D com cabo de madeira nobre, estrutura em latão e borracha vermelha.
     - Lixeira corporativa em malha de aço escovado com papéis amassados.
     - Modelos 3D para os itens:
       - **Documentos Válidos**: Contrato oficial assinado, Pasta de processos com abas e clipe, Carta com lacre de cera, Crachá corporativo RFID.
       - **Itens de Descarte**: Xícara de café fumegante de cerâmica, Lixeira de spam/panfleto, Meme do sapo em 3D voxelizado.
5. `fun_dashboard/src/components/intern/glParticles.ts`:
   - Sistema de partículas 3D acelerado por GPU:
     - *Vapor de Café*: fumaça suave com física de subida e dissipação.
     - *Faíscas Laser*: faíscas azuis/turquesa ao digitalizar documentos.
     - *Confetes & Estrelas*: explosão de partículas douradas e verdes ao protocolar com sucesso.
     - *Descarte*: papéis em arco parabólico em direção à lixeira.
     - *Glitch/Erro*: faíscas vermelhas e screen shake em caso de erro.
6. `fun_dashboard/src/components/intern/glCamera.ts`:
   - Câmera 3D dinâmica com 3 modos selecionáveis:
     - **Isométrica** (visão tática elevada elegante da mesa e sala).
     - **Primeira Pessoa** (visão do operador estagiário sentado na estação).
     - **Ação** (close dramático no scanner e carimbo mecânico).
   - Suporte a screen shake sutil em impactos/erros e damping suave (lerp).
7. `fun_dashboard/src/components/intern/InternOpenGLRenderer.ts`:
   - Controlador do ciclo de vida WebGL2, pipeline de iluminação, animações físicas (carimbo descendo com impacto acelerado, scanner deslizando, flutuação e descarte de itens).
8. `fun_dashboard/src/components/intern/InternGameOpenGL.tsx`:
   - Componente React cliente integrado na rota `fun_dashboard/src/app/job/play/page.tsx`.
   - HUD profissional estilo *glassmorphism* com barra de tempo analógica/digital, medidor de advertências do RH e feedback instantâneo.
   - Controles responsivos: teclado (`Espaço`/`Enter`/`P` para Protocolar, `Backspace`/`Delete`/`Seta Direita`/`N` para Próximo, `1`/`2`/`3` para alternar câmeras), toque no canvas e botões táteis.
9. `fun_dashboard/src/lib/soundEngine.ts`:
   - Efeitos sonoros sintetizados nativos em Web Audio API: impacto mecânico do carimbo, sweep futurista de scanner laser, swoosh de descarte, alarme de advertência do RH e fanfarra de contratação.

---

## 3. Como Rodar e Testar

### 3.1 Instalação e Execução
```bash
# Executar a aplicação Dashboard (Next.js)
npm run fun:dashboard

# Ou compilar o bundle de produção:
npm run fun:dashboard:build
```

### 3.2 Executar os Testes Automatizados
```bash
# Executar suíte de testes de empregos (valida mecânica do Estagiário)
node --test --import ./tests/test-env-setup.js tests/fun-jobs.test.js

# Executar todas as suítes de testes
npm test
```

---

## 4. Validação da Mecânica e Testes
- **Taxa de acertos nos testes de backend**: 100% de aprovação (9/9 testes passando em `tests/fun-jobs.test.js`).
- **Preservação de regras**:
  - `targetScore`: 8 acertos para aprovação.
  - `maxMistakes`: máximo de 3 erros permitidos.
  - `durationMs`: 60.000 ms (60 segundos).
  - `practice`: modo de treino grátis mantido isolado e sincronizado com o banco SQLite.
  - `finish`: envio de métricas `{ score, durationMs, metrics: { mistakes } }` inalterado.
