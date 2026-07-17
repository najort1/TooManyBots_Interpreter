# Fun Bot — Roadmap P1 & P2 (pós-P0)

> Base: P0 já implementado (panelinhas, ponte social, missões mistas, evento relâmpago).  
> Só avance se o P0 gerar engajamento real no grupo (panelinhas criadas, `/panelinha` usado, missões completadas).

---

## Estado do P0 (referência)

| Feature | Comandos | Tabelas |
|---------|----------|---------|
| Panelinhas + cofre | `/panelinha criar\|entrar\|sair\|doar\|info\|rank` | `fun_factions`, `fun_faction_members` |
| Ponte / relatório CIA | `/panelinha` (sem args), `/ponte` | `fun_social_edges` |
| Missões mistas | `/missao`, `/missao spawn`, `/squad` | `fun_mixed_missions` |
| Evento cross | `/evento`, `/evento start` | `fun_scope_events` |
| Hooks | pay/aposta/ship/marry/daily | `socialHooks` |

Arquivos-chave: `fun/services/factionService.js`, `bridgeService.js`, `missionService.js`, `eventService.js`, `socialHooks.js`.

---

## Princípios (não negociar)

1. Punição **só in-game** (coins, título, rank) — nunca kick/ban por meta.
2. Drama é **público e de zoeira**, não fofoca de DM.
3. Caps de stake/cooldown (reusar `betMax`, `eventCooldownMs`, etc.).
4. Opt-out de panelinha sempre possível (taxa, não prisão).
5. Tudo isolado por `scope_key` (grupo WhatsApp).
6. Identidade canônica `@s.whatsapp.net` (LID resolvido).

---

## P1 — Tensão estratégica

### 1. Alianças públicas + traição

**Meta:** laços entre panelinhas visíveis + drama de traição.

| Item | Detalhe |
|------|---------|
| Schema | `fun_faction_alliances (scope_key, a_id, b_id, status, created_at)` |
| Actions | `ACTION_TYPE.ALLIANCE` em `pending_actions` |
| Comandos | `/alianca propor Nome`, `/alianca listar`, `/alianca romper`, `/trair Nome`, `/mapa` |
| Effects | buff `alliance_job` (+10% job) enquanto aliança ativa |
| Traição | rouba % do cofre aliado (cap), anuncia no chat, título `Infame` 7d, bloqueia nova aliança 7d |
| Encaixe | `factionService` + `effectsRepository` + ledger `vault-steal` |

**Ordem de implementação**

1. Tabela + repo alianças  
2. Propor/aceitar/recusar via pending  
3. Buff job quando aliado  
4. `/trair` + anúncio + cooldown  

### 2. Guerra de influência (semanal)

**Meta:** temporada com placar, não toxicidade 1v1.

| Item | Detalhe |
|------|---------|
| Schema | `fun_war_seasons`, `fun_war_scores (season_id, faction_id, points)` |
| Pontos | missão mista +10, aposta inter-panelinha +5, daily coletivo panelinha +1, ponte alta +bonus |
| Comandos | `/guerra`, `/guerra rank`, `/desafiar Nome` (opcional: duelo de cofre simbólico) |
| Fim de semana | top1 taxa 5% do cofre do top2 (cap), título coletivo 7d |
| Scheduler | job no `runtime` (timer) ou check lazy no `/guerra` |

**Ordem**

1. Season key (semana ISO, reusar `getWeekKey`)  
2. Pontuar nos hooks de `socialHooks` / mission complete  
3. Rank + premiação lazy no domingo  

### 3. Espionagem / contra-espionagem

| Item | Detalhe |
|------|---------|
| Comandos | `/espiar Nome`, `/contraespionagem` |
| Custo | coins da loja ou valor fixo |
| Sucesso | revela top 3 doadores do cofre (ledger filtrado) ou último membro que entrou |
| Falha | 30% chance de anúncio público “fulano foi pego” |
| Loja | item `escudo` (charge) bloqueia 1 espionagem |

**Ordem**

1. Query ledger/cofre  
2. RNG sucesso/falha  
3. Item escudo na catalog  

### Checklist de aceite P1

- [ ] Aliança aparece em `/mapa` e `/panelinha info`  
- [ ] Traição anuncia no grupo e altera cofre  
- [ ] Guerra tem placar semanal sem spam diário  
- [ ] Espionagem custa coins e pode falhar publicamente  
- [ ] Testes unitários em services + 1 teste de integração  

---

## P2 — Drama de zoeira

### 4. Tribunal da zoeira

| Item | Detalhe |
|------|---------|
| Comandos | `/processar @user motivo`, `/votar culpa\|inocente` |
| Júri | 5 usuários de panelinhas mistas (ou aleatório se <3 panelinhas) |
| Pena | multa coins, título `Condenado` 24h, opcional −rank 24h |
| Pending | multi-voto em `payload_json` com `votes: {jid: side}` |
| Segurança | motivo max 80 chars; sem doxxing; mute/ban fora de escopo |

### 5. Mercado negro de “segredos”

| Item | Detalhe |
|------|---------|
| Comandos | `/vazar preco texto`, `/comprar-segredo id` |
| Schema | `fun_secret_listings` |
| Taxa bot | 10–20% do preço |
| Filtro | blocklist de palavras + max length; **sem mídia** |
| Risco | conteúdo ofensivo — feature flag `secretsEnabled: false` default |

### 6. Casamento político

| Item | Detalhe |
|------|---------|
| Extensão | em `acceptMarry`, se panelinhas diferentes → buff 48h nas duas panelinhas |
| Divórcio cross | multa extra + anúncio “crise diplomática” |
| Encaixe | `relationshipService` + `factionService.getUserFaction` |

### 7. Rei do Caos

| Item | Detalhe |
|------|---------|
| Elegibilidade | maior delta de ponte / ações externas na semana |
| Cargo | 1 comando/dia: `/caos missao` (força spawn) ou `/caos evento` (força evento se cd ok) |
| Comandos | `/coroa`, `/caos` |
| Persistência | `fun_scope_meta` ou `fun_module_meta` com `chaos_king:{scope}` |

### 8. Batalha de cofres (heist)

| Item | Detalhe |
|------|---------|
| Comandos | `/assaltar Nome`, `/entrar-assalto`, `/defender` |
| Regra anti-panelinha | time precisa de 1 outsider (outra panelinha) |
| Sucesso | 10–20% do cofre alvo (cap) |
| Falha | multa + anúncio |
| Complexidade | **última** do P2 — só se guerra e alianças estiverem maduras |

### Checklist de aceite P2

- [ ] Tribunal com júri misto e pena só in-game  
- [ ] Mercado com flag off por default  
- [ ] Casamento cross-panelinha dá buff mensurável  
- [ ] Rei do Caos escolhido por métrica de ponte  
- [ ] Heist impossível sem outsider  

---

## Ordem sugerida pós-validação do P0

```text
Semana 0–2: só P0 em produção, medir:
  - panelinhas criadas / grupo
  - % membros em panelinha
  - missões spawnadas vs completadas
  - usos de /panelinha e /evento

Se engajar:
  → P1.1 Aliança/traição
  → P1.2 Guerra semanal
  → P1.3 Espionagem

Se ainda engajar e o tom do grupo aguentar:
  → P2 seletivo (Rei do Caos + casamento político primeiro)
  → Tribunal / mercado / heist só com flag
```

---

## Métricas de sucesso do P0 (pra decidir P1)

| Métrica | Sinal positivo |
|---------|----------------|
| Facções ≥ 2 ativas no grupo | há “times” |
| Doações ao cofre | economia coletiva |
| `/missao` completa ≥ 1x/semana | squad funciona |
| Ponte média sobe após missões | anti-panelinha funciona |
| Spam reclamações | reduzir anúncios automáticos |

---

## Estrutura de pastas futura (P1+)

```text
fun/
  db/funAllianceRepository.js
  db/funWarRepository.js
  services/allianceService.js
  services/warService.js
  services/spyService.js
  services/courtService.js
  commands/handlers/alliance.js
  commands/handlers/war.js
  ...
```

---

*Documento gerado junto com a implementação do P0. Atualize checklists conforme for shipando.*
