# Debug Session: persona-runtime-signals
- **Status**: [OPEN]
- **Issue**: Menção e resposta citada à persona não acionam resposta no WhatsApp real, apesar das correções estáticas e testes locais.
- **Debug Server**: Pending startup
- **Log File**: `.dbg/trae-debug-log-persona-runtime-signals.ndjson`

## Reproduction Steps
1. Iniciar o bot Fun com a instrumentação ativa.
2. Em um grupo elegível, enviar uma menção real ao bot com texto neutro.
3. Responder diretamente a uma mensagem anterior da persona.
4. Analisar os eventos de entrada, identidades locais, decisão da persona e envio.

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | A mensagem não chega ao runtime/pipeline. | Medium | Low | Pending |
| B | `mentionedJid`/participante citado não é extraído do envelope real. | High | Low | Pending |
| C | A identidade PN/LID local do bot não está disponível ou não corresponde ao payload. | High | Low | Pending |
| D | A persona é chamada, mas algum guard bloqueia a resposta. | Medium | Low | Pending |
| E | A persona responde, mas o envio falha ou é suprimido posteriormente. | Low | Low | Pending |

## Log Evidence
Pending runtime reproduction.

## Verification Conclusion
Pending runtime evidence.
