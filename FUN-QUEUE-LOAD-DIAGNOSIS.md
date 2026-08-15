# Diagnóstico de carga das filas do Fun

## Escopo

Este diagnóstico cobre o processamento de mensagens do bot Fun, desde o evento `messages.upsert` até o envio da resposta. O foco é evitar descarte silencioso durante conversa simultânea de muitos usuários.

## Limites observados antes do ajuste

| Componente | Limite anterior | Efeito sob carga |
| --- | ---: | --- |
| `runtime/ingestionQueue.js` | 8 workers, 5.000 pendências padrão | Rejeita novas entradas com `queue-overflow` ao lotar; preserva ordem por chave. O Fun standalone não usa esta fila para comandos. |
| `runtime/commandQueue.js` no Fun | 4 rápidas + 2 de estado + 4 pesadas; 5.000 total lógico | Cada classe recebe uma partição fixa: 50% rápida, 30% estado, 20% pesada. O Fun desativava timeouts para evitar drops de IA, mas uma fila cheia ainda era descartada. |
| `runtime/outputQueue.js` | 4 envios concorrentes, 600 ms de gap, 2.000 pendências | O agendamento do gap era global na prática e podia atrasar grupos não relacionados. Overflow devolvia rejeição; os wrappers do runtime não tratavam esse retorno e podiam aguardar para sempre. |
| `engine/outboundGuard.js` | 25/min global, 12/min por JID, 900 ms por JID, wait cap 15 s | Não limita o Fun: os três wrappers de envio do runtime passam `skipGuard: true`. |
| Persona | `personaCooldownMs=0`, `personaMaxTurns=0` | Não bloqueia respostas por cooldown ou limite de turnos; a persona ainda limita uma geração em voo por grupo por desenho. |

## Causas confirmadas

1. **Overflow de comando era perda explícita e pouco visível.** O resultado de `commandQueue.enqueue` era ignorado quando `debugMode=false`; a mensagem rejeitada por capacidade não aparecia na TUI.
2. **Overflow de saída podia deixar o chamador pendente.** Os wrappers de texto, imagem e sticker criavam uma `Promise`, mas não verificavam `accepted=false` de `outputQueue.enqueue`.
3. **O gap de saída não era isolado por conversa.** Depois de um envio, o timer atrasava o próximo dreno em vez de apenas o próximo item do mesmo JID. Isso adicionava latência aos demais grupos e tornava a fila crescer mais rápido em carga.
4. **IA pesada deve continuar sem timeout de fila.** Um timeout que abandona trabalho em andamento é uma perda. A configuração do Fun mantém todos os timeouts de tarefa em zero; o limite de pendências é o backpressure observável.

## Ajustes aplicados

| Configuração | Novo valor | Arquivo |
| --- | ---: | --- |
| `commandMaxConcurrency` | 20 | `fun/constants.js`, `fun/config.user.json` |
| `commandFastConcurrency` | 8 | `fun/constants.js`, `fun/config.user.json` |
| `commandStateConcurrency` | 4 | `fun/constants.js`, `fun/config.user.json` |
| `commandHeavyConcurrency` | 8 | `fun/constants.js`, `fun/config.user.json` |
| `commandQueueMax` | 20.000 | `fun/constants.js`, `fun/config.user.json` |
| `commandQueueWarnThreshold` | 2.000 | `fun/constants.js`, `fun/config.user.json` |
| `outputConcurrency` | 8 | `fun/constants.js`, `fun/config.user.json` |
| `outputJidGapMs` | 250 ms | `fun/constants.js`, `fun/config.user.json` |
| `outputCoalesceDelayMs` | 1.000 ms | `fun/constants.js`, `fun/config.user.json` |
| `outputQueueMax` | 10.000 | `fun/constants.js`, `fun/config.user.json` |

O runtime também reporta cada `command-rejected` para a categoria **queue** da TUI, incluindo a classe da fila e o motivo. O snapshot da output queue passou a informar `maxQueueSize`.

## Estratégia de teste

O teste `stress queue: 120 users receive every routed LLM reply without drops` simula 120 usuários do mesmo grupo acionando `/tarot` em paralelo. Cada resposta percorre uma command queue com roteamento por ator e uma output queue com 8 workers. O teste exige:

- 120 entradas aceitas;
- 120 tarefas concluídas sem falhas ou rejeições;
- 120 respostas enviadas sem falhas ou rejeições;
- 120 usuários distintos atendidos;
- latência p95 inferior a 1,5 s no ambiente de teste.

O teste adicional de output queue confirma que o gap de 100 ms vale apenas entre duas respostas ao mesmo JID; outro grupo continua sendo servido imediatamente.

## Como validar em ambiente real

1. Inicie o bot em terminal interativo com `tuiEnabled: true`: `npm run fun`.
2. Gere carga gradual com usuários reais de teste: 20, 50, 100 e 120 comandos curtos ou `/tarot` distribuídos entre participantes.
3. Na aba **Saúde**, observe `Fila cmd`, rejeições, falhas, `Out`, p95 de espera e o tamanho máximo configurado. A aprovação exige rejeições e falhas iguais a zero.
4. Na aba **Auditoria**, filtre/acompanhe a categoria **queue**. Qualquer `command-rejected` significa perda confirmada e requer reduzir carga ou aumentar capacidade antes de prosseguir.
5. Na aba **Grupos**, confirme atividade nos grupos esperados e que todos os participantes de teste receberam resposta.
6. Execute os testes automatizados antes de publicar: `node --test --import ./tests/test-env-setup.js tests/ingestion-queue.test.js`, `node --test --import ./tests/test-env-setup.js --test-name-pattern "stress queue: 120 users" tests/fun-stress.test.js`, e `npm run test`.

## Limitações e acompanhamento

- Não há como garantir entrega depois que o Baileys/WhatsApp aceita uma mensagem sem observar recibos de entrega. Este trabalho garante que o processo não a descarte silenciosamente antes do envio e torna as rejeições visíveis.
- A persona preserva o limite de uma geração LLM por grupo em voo para não produzir respostas concorrentes ao mesmo gatilho. Esse comportamento é diferente de comandos dirigidos a usuários e não deve ser removido sem uma política explícita de fila para persona.
- Se a TUI observar backlog sustentado acima de 2.000 ou qualquer rejeição, trate isso como sinal de capacidade insuficiente: investigue a latência do provedor LLM e a taxa real de `sock.sendMessage` antes de aumentar concorrência outra vez.
