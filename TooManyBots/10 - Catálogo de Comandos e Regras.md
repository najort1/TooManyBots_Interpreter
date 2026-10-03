---
title: Catálogo de Comandos e Regras - TooManyBots Fun
date: 2026-09-30
tags:
  - comandos
  - regras
  - cooldowns
  - catalogo
  - permissoes
aliases:
  - Catálogo de Comandos e Regras
  - Comandos Fun
  - Help Guide
---

# 📖 Catálogo Completo de Comandos e Regras

Esta nota consolida o catálogo oficial de todos os comandos do bot Fun (`fun/commands/catalog.js` e `fun/constants.js`), com categorias, escopos permitidos e regras de uso.

---

## 1. Princípios de Execução e Escopo

> [!important] Regras Gerais de Escopo
> 1. **Privado vs Grupo**:
>    - Comandos sociais, duelos, panelinhas e jogos coletivos funcionam **exclusivamente em grupo**.
>    - No privado (DM), se o usuário pertencer a um grupo na whitelist, são permitidos comandos solo (saldo, daily, ranks, jogos solo como `/roleta`, `/bj`, `/crash`, `/slot`).
>    - O comando `/grupo` no DM permite selecionar a qual grupo as ações privadas do jogador se referem.
> 2. **Segurança contra Bans**: O bot **nunca envia DMs espontâneas** a partir de um comando digitado no grupo (`shouldReplyCommandInPrivate` retorna `false` estrito). Toda resposta é enviada no mesmo canal onde foi chamada.
> 3. **Citação e Marcação**: Em grupos, o bot cita (`quotedMessage`) a mensagem do autor e marca seu `@` para que a resposta não se perca no fluxo do chat.

---

## 2. Tabela Mestra de Comandos por Categoria

### 2.1. Perfil & Nível
| Comando | Aliases | O que faz | Escopo | Cooldown |
|---|---|---|---|---|
| `/xp` | `/perfil`, `/status` | Exibe nível, progresso de XP, moedas e título do jogador | Grupo / DM | 5s |
| `/rank` | `/top` | Ranking dos maiores níveis e XP do grupo | Grupo / DM | 10s |
| `/rankcoins` | `/topcoins`, `/ricos` | Ranking dos jogadores mais ricos do grupo | Grupo / DM | 10s |
| `/rankmessages`| `/topmsg` | Ranking dos membros mais ativos em mensagens | Grupo / DM | 10s |
| `/conquistas` | `/achievements` | Lista as conquistas desbloqueadas e pendentes | Grupo / DM | 5s |

### 2.2. Economia, Emprego & Bolsa
| Comando | Aliases | O que faz | Escopo | Cooldown |
|---|---|---|---|---|
| `/daily` | `/diario` | Coleta recompensa diária de XP e Coins (com bônus de streak) | Grupo / DM | 24h |
| `/saldo` | `/coins`, `/moedas` | Consulta saldo atual de moedas | Grupo / DM | Livre |
| `/pay <qtd> @user` | `/pagar` | Transfere coins para outro membro com registro no ledger | **Só Grupo** | Livre |
| `/trabalhar` | `/job` | Realiza um trabalho temporário (freela) | Grupo / DM | 2 horas |
| `/emprego [nome]` | `/contratar` | Consulta cargos CLT disponíveis ou contrata uma profissão fixa | Grupo / DM | Livre |
| `/demitir sim` | `/resign` | Pede demissão voluntária do cargo atual | Grupo / DM | Livre |
| `/bolsa` | `/acoes` | Consulta cotações da bolsa e envia link da corretora web | Grupo / DM | 30s |
| `/carteira` | `/portifolio` | Exibe ações que o jogador possui em custódia | Grupo / DM | 10s |
| `/bolsa comprar <empresa> <qtd>` | — | Compra ações de uma das 6 corporações | **Só Grupo** | 10s |
| `/bolsa vender <empresa> <qtd>` | — | Vende ações com crédito instantâneo | **Só Grupo** | 10s |

### 2.3. Jogos Casuais & Apostas
| Comando | Aliases | O que faz | Escopo | Cooldown |
|---|---|---|---|---|
| `/cf <qtd> <cara\|coroa>` | `/flip` | Cara ou coroa rápido contra a banca | Grupo / DM | 45s |
| `/sorte` | `/lucky` | Sorteio aleatório de moedas (ou perda) | Grupo / DM | 3 horas |
| `/aposta @user <qtd> <escolha>`| `/bet` | Duelo de aposta P2P entre dois membros | **Só Grupo** | Livre |
| `/roletarussa` | `/russian` | Inicia jogo de roleta russa virtual | **Só Grupo** | 60s |
| `/puxar` | `/pull` | Puxa o gatilho da roleta russa | **Só Grupo** | Livre |
| `/desafio` | `/challenge` | Exibe o status ou resposta do enigma diário ativo | **Só Grupo** | Livre |
| `/desafio pular`| — | Vota para pular o enigma atual (requer 3 votos) | **Só Grupo** | Livre |

### 2.4. Cassino
| Comando | Aliases | O que faz | Escopo | Cooldown |
|---|---|---|---|---|
| `/roleta <tipo> <aposta>` | `/roulette` | Roleta europeia completa com regra La Partage | Grupo / DM | 15s |
| `/slot <aposta>`| `/cacaniqueis` | Caça-níqueis com 3 cilindros | Grupo / DM | 15s |
| `/jackpot` | `/acumulado` | Exibe o pote de ouro acumulado do grupo | Grupo / DM | Livre |
| `/crash <aposta>`| — | Inicia corrida de multiplicador de Crash | Grupo / DM | Livre |
| `/cashout` | `/parar` | Garante o lucro da rodada de Crash | Grupo / DM | Livre |
| `/bj <aposta>` | `/blackjack`, `/21`| Inicia partida de 21 contra o dealer | Grupo / DM | Livre |
| `/hit` | `/pedir` | Pede mais uma carta no Blackjack | Grupo / DM | Livre |
| `/stand` | `/parar21` | Encerra a mão e passa a vez para o dealer | Grupo / DM | Livre |
| `/bingo <aposta>`| — | Compra cartela de bingo solo ou em sala | Grupo / DM | 30s |
| `/torneio` | — | Abre ou consulta torneio eliminatório de 8 pessoas | **Só Grupo** | Livre |
| `/rankcassino` | `/topcassino` | Placar dos maiores vencedores e perdedores do cassino | Grupo / DM | 10s |

### 2.5. Panelinhas & Dinâmica Social
| Comando | Aliases | O que faz | Escopo | Cooldown |
|---|---|---|---|---|
| `/relacao @user` | `/quimica` | Visualizador da Matriz 4D (Afeto, Rivalidade, Intimidade, Caos) e arquétipo | Grupo / DM | Livre |
| `/bounty @user <valor> [motivo]` | — | Emite contrato de caça no submundo contra um desafeto (taxa 20% retida) | **Só Grupo** | Livre |
| `/bounty lista` | — | Lista os contratos de recompensa ativos e mais procurados no grupo | Grupo / DM | 10s |
| `/bounty cancelar <id>` | — | Cancela contrato emitido estornando o valor líquido (taxa retida) | Grupo / DM | Livre |
| `/tribunal @user [acusacao]` | — | Abre sessão de júri popular de 90s com jurados do grupo (caução 150 coins) | **Só Grupo** | Livre |
| `/tribunal status` | `/tribunal ver` | Consulta o placar parcial e tempo restante da sessão de julgamento | **Só Grupo** | Livre |
| `/tribunal resolver` | `/veredito` | Proclama o veredito oficial do tribunal ao término dos 90s | **Só Grupo** | Livre |
| `/voto culpado` / `/voto inocente` | — | Registra o voto de jurado popular no julgamento ativo (peso ponderado) | **Só Grupo** | Livre |
| `/panelinha` | `/faccao` | Exibe informações da sua panelinha ou lista geral | **Só Grupo** | Livre |
| `/panelinha criar <nome>` | — | Funda uma nova panelinha (custa 50 coins) | **Só Grupo** | Livre |
| `/panelinha entrar <nome>`| — | Solicita entrada em uma panelinha existente | **Só Grupo** | Livre |
| `/panelinha sair` | — | Sai da panelinha atual (taxa de 25 coins) | **Só Grupo** | Livre |
| `/panelinha doar <qtd>` | — | Deposita moedas no cofre da sua panelinha | **Só Grupo** | Livre |
| `/ponte` | `/cia` | Relatório de integração social e índice de panelinhas | **Só Grupo** | 60s |
| `/missao` | `/squad` | Exibe a missão mista de squad ativa no grupo | **Só Grupo** | Livre |
| `/evento` | — | Exibe o evento de bônus ativo no grupo (ou tempo restante) | **Só Grupo** | Livre |
| `/marry @user` | `/casar` | Pede um membro em casamento (concede +15% no /daily se ativos em 48h) | **Só Grupo** | Livre |
| `/aceitar` | `/sim` | Aceita pedido de casamento pendente | **Só Grupo** | Livre |
| `/recusar` | `/nao` | Recusa pedido de casamento pendente | **Só Grupo** | Livre |
| `/divorce` | `/divorcio` | Divórcio oficial (amigável: 40 coins; litigioso por adultério: pensão 20%) | **Só Grupo** | Livre |
| `/ship @a @b` | — | Compatibilidade real 4D derivada do histórico e laudo diagnóstico | Grupo / DM | Livre |
| `/despedir` | — | Registra saída dramática do usuário para o ranking | **Só Grupo** | Livre |

### 2.6. Mercado, Colecionáveis & Casas
| Comando | Aliases | O que faz | Escopo | Cooldown |
|---|---|---|---|---|
| `/loja` | `/shop` | Exibe o catálogo da loja oficial de itens | Grupo / DM | Livre |
| `/comprar <item>`| `/buy` | Compra item oficial da loja | Grupo / DM | Livre |
| `/inventario` | `/mochila` | Lista os itens que você possui e suas condições | Grupo / DM | Livre |
| `/bazar` | — | Lista itens anunciados por outros membros do grupo | Grupo / DM | Livre |
| `/vender <id> <preco>` | `/anunciar` | Coloca um item do seu inventário à venda no bazar | Grupo / DM | Livre |
| `/consertar <id>`| `/repair` | Conserta arma, veículo ou mobi quebrado | Grupo / DM | Livre |
| `/casa` | `/habbo` | Entrega link pessoal para o editor da casa virtual | **Instrui DM** | Livre |
| `/avatar` | — | Entrega link pessoal para customização do avatar 3D | **Instrui DM** | Livre |
| `/meucarro` | `/garagem` | Gera e envia imagem 2D renderizada do seu carro tunado | Grupo / DM | 30s |
| `/cartas` | `/gacha` | Abre pacotes de cartas colecionáveis ou lista coleção | Grupo / DM | 30s |

### 2.7. Zoeira, Mídia & IA
| Comando | Aliases | O que faz | Escopo | Cooldown |
|---|---|---|---|---|
| `/tarot [pergunta]` | `/cartomante` | Tiragem completa de 3 cartas com interpretação da IA | Grupo / DM | 45s |
| `/fofoca` | `/gossip` | A IA inventa uma fofoca cômica sobre alguém do grupo | Grupo / DM | 30s |
| `/oraculo <pergunta>` | `/oracle` | Pergunta com resposta misteriosa gerada por IA | Grupo / DM | 20s |
| `/illuminati @user` | — | Cria uma teoria da conspiração cômica sobre o alvo | Grupo / DM | 30s |
| `/cancelar @user` | `/cancel` | Gera uma nota de cancelamento bem-humorada | Grupo / DM | 30s |
| `/roast @user` | `/zoar` | A IA faz um roast ácido baseado no perfil e micos do alvo | Grupo / DM | 45s |
| `/lore [termo]` | — | Consulta a lore e memórias que o bot aprendeu do grupo | Grupo / DM | Livre |
| `/fig` | `/sticker` | Converte imagem/vídeo enviado ou citado em figurinha | Grupo / DM | 10s |
| `/gerar <prompt>` | `/imaginar` | Gera imagem por IA (limite de 25 imagens/dia por grupo) | Grupo / DM | 60s |

---

## 3. Navegação Relacionada
- [[00 - Hub Central]]: Retorno ao índice mestre.
- [[01 - Arquitetura e Runtime]]: Roteamento e filas que processam estes comandos.
- [[05 - Panelinhas e Dinâmica Social]]: Regras avançadas de alianças e missões.
