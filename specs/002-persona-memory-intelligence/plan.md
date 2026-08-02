# Implementation Plan: Persona Memory Intelligence

**Branch**: `[002-persona-memory-intelligence]` | **Date**: 2026-08-02 | **Spec**: [spec.md](file:///c:/Users/najort/Documents/GitHub/TooManyBots_Interpreter/specs/002-persona-memory-intelligence/spec.md)

**Input**: Feature specification from `/specs/002-persona-memory-intelligence/spec.md`

## Summary

Expandir a persona do módulo `fun/` para responder com contexto conversacional correto, memória confiável e identidade consistente por grupo. A abordagem técnica escolhida é introduzir uma camada explícita de contexto e memória sobre a base atual da persona, com tipagem de memória, confiança por fato, resolução de thread por reply, retrieval rankeado, identidade por grupo e decay controlado, preservando triggers, fallback e isolamento por `scope_key`.

## Technical Context

**Language/Version**: JavaScript ESM em Node.js no módulo `fun/`

**Primary Dependencies**: runtime atual do módulo `fun/`, `better-sqlite3`, serviços/repositórios já existentes de persona, profile e lore de grupo, geração LLM já integrada ao módulo

**Storage**: SQLite isolado do módulo `fun/`, com schema versionado e persistência por `scope_key`

**Testing**: `node --test` com banco isolado e execução determinística sem rede para a suíte da feature

**Target Platform**: processo backend standalone do módulo `fun/` integrado ao runtime WhatsApp do projeto

**Project Type**: backend/service module orientado a eventos de chat

**Performance Goals**: montar contexto e selecionar memória relevante sem degradar perceptivelmente o fluxo atual de resposta da persona; respostas devem continuar curtas, oportunas e compatíveis com o uso em grupo

**Constraints**: isolamento estrito por `scope_key`; identidade canônica de usuário; falha de memória não pode quebrar resposta; memórias sensíveis não podem ser usadas como personalização; integração deve preservar comportamento atual de trigger e fallback

**Scale/Scope**: múltiplos grupos ativos com conversas paralelas, memória por grupo, threads curtas, fatos persistidos e seleção contextual recorrente ao longo do uso da persona

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **Arquitetura em camadas**: PASSA. O plano segue `constants → schema → repo → service → pipeline → testes` e mantém regras de negócio em serviços.
- **Isolamento por `scope_key`**: PASSA. Todos os novos artefatos de memória e thread são modelados por grupo e impedem leak entre escopos.
- **Persistência e schema versionado**: PASSA. O plano pressupõe novas tabelas idempotentes em `fun/schema.js` e incremento de versão do schema.
- **Comportamento e segurança social**: PASSA. O design inclui sensibilidade, supressão e limite explícito contra personalização invasiva.
- **Qualidade e testes determinísticos**: PASSA. A estratégia assume `node --test`, banco isolado e sem dependência de rede para validar o pipeline de memória.
- **Fallback de LLM não bloqueante**: PASSA. O serviço de persona mantém fallback seguro quando o contexto ou a geração falham.

## Project Structure

### Documentation (this feature)

```text
specs/002-persona-memory-intelligence/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── persona-context-contract.md
└── tasks.md
```

### Source Code (repository root)

```text
fun/
├── constants.js
├── config.js
├── schema.js
├── index.js
├── runtime.js
├── pipeline/
│   └── onIncomingMessage.js
├── db/
│   ├── funConversationMemoryRepository.js
│   ├── funThreadContextRepository.js
│   ├── funPersonaIdentityRepository.js
│   ├── funPersonaRepository.js
│   ├── funMemoryRepository.js
│   └── funProfileRepository.js
└── services/
    ├── personaService.js
    ├── personaContextService.js
    ├── memoryRetrievalService.js
    ├── memoryIngestionService.js
    ├── threadContextService.js
    ├── socialMemoryService.js
    ├── personaIdentityService.js
    ├── memoryDecayService.js
    ├── groupMemoryService.js
    └── profileService.js

tests/
├── fun-thread-context.test.js
├── fun-memory-retrieval.test.js
├── fun-memory-ingestion.test.js
├── fun-persona-context.test.js
├── fun-social-memory.test.js
├── fun-persona-reply-continuity.test.js
├── fun-persona-memory-ranking.test.js
├── fun-persona-confirmed-vs-inferred.test.js
└── fun-persona-identity-group.test.js
```

**Structure Decision**: A feature será implementada inteiramente dentro do módulo `fun/`, reusando o runtime e os serviços existentes de persona, lore e perfil. A nova complexidade fica distribuída em novos repositórios e serviços especializados, com integração concentrada em `fun/index.js` e `fun/pipeline/onIncomingMessage.js`.

**Catálogo implementado**: persistência versionada `fun_conversation_memories`, `fun_thread_contexts` e `fun_persona_identities`; configuração `personaMemoryEnabled`/`personaMemoryMaxContextItems`; e serviços de thread, ingestão, retrieval, decay, contexto e identidade.

## Phase 0: Research

### Objetivos resolvidos
- Definir que a persona precisa de uma camada explícita de contexto em vez de apenas aumentar prompt.
- Definir taxonomia de memória por tipo e por nível de evidência.
- Definir prioridade de reply para continuidade de thread.
- Definir identidade persistente por grupo.
- Definir decay, supressão e observabilidade como parte do fluxo padrão.

### Saída
- [research.md](file:///c:/Users/najort/Documents/GitHub/TooManyBots_Interpreter/specs/002-persona-memory-intelligence/research.md)

## Phase 1: Design & Contracts

### Data model
- [data-model.md](file:///c:/Users/najort/Documents/GitHub/TooManyBots_Interpreter/specs/002-persona-memory-intelligence/data-model.md)

### Contracts
- [persona-context-contract.md](file:///c:/Users/najort/Documents/GitHub/TooManyBots_Interpreter/specs/002-persona-memory-intelligence/contracts/persona-context-contract.md)

### Validation guide
- [quickstart.md](file:///c:/Users/najort/Documents/GitHub/TooManyBots_Interpreter/specs/002-persona-memory-intelligence/quickstart.md)

## Post-Design Constitution Check

- **Camadas**: PASSA. Os novos componentes se encaixam no padrão do módulo e evitam regra de negócio em repositório ou pipeline.
- **Escopo do módulo `fun/`**: PASSA. Toda a solução permanece standalone no backend do módulo.
- **Isolamento por grupo**: PASSA. O modelo reforça `scope_key` como chave obrigatória em memória, thread e identidade.
- **Segurança social e sensibilidade**: PASSA. O design introduz classificação e bloqueio de memórias sensíveis.
- **Testabilidade determinística**: PASSA. O plano prevê testes unitários, integração e comportamento focados no contexto selecionado e não apenas no texto gerado.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Nenhuma violação | N/A | N/A |
