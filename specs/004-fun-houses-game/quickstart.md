# Quickstart — Validação do Jogo de Casas e Avatares (fun)

**Created**: 2026-08-14 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Contracts**: [api-web.md](./contracts/api-web.md) | **Data model**: [data-model.md](./data-model.md)

Guia de validação ponta a ponta. Não substitui o design de tasks nem o código; serve para provar que a feature funciona.

## Pré-requisitos

- Repo clonado; dependências da raiz e de `fun_dashboard/` instaladas.
- Banco do módulo fun isolado em `data/fun/` (TMB_DATA_DIR) — o standalone `npm run fun` usa isso.
- Config com as novas chaves (relacionadas a default): `housesEnabled`, `avatarEnabled`, `visitsEnabled`, `giftsEnabled`, `robberyEnabled` (default true).
- Backend da web: `fun/dashboard/server.js` no processo `fun` (porta `dashboardPort`, default 8790).
- Frontend: `fun_dashboard` com o proxy de rewrites existente (`FUN_API_URL` default `http://127.0.0.1:8790`).

## Cenários de validação (runnable)

### 1. Setup & init

```bash
# test suites do módulo fun (determinísticas, sem rede, banco temporário)
npm test -- --test-name-pattern="houses|avatar|visit|gift|robbery|token" 
# build do dashboard (para UI nova)
npm run fun:dashboard:build
# sane check do módulo standalone
npm run fun:dev --setup
```

**Esperado**: testes passam (ledger atômico, caps, saldo não-negativo, roba determinístico), build do dashboard verde.

### 2. Comando `/casa` (grupo → DM → link)

- Iniciar o módulo `fun` com um grupo na whitelist.
- No grupo, enviar `/casa` → o bot responde: "chame o bot no privado e digite /casa".
- No DM (usuário iniciou conversa), `/casa` → o bot responde com o **link pessoal** (e resumo: saldo, tetos).
- Nunca deve enviar o link em grupo; o bot nunca inicia conversa privada.

**Esperado** conforme FR-027/028/033.

### 3. Primeiro acesso / provisionamento (navegador)

- Abrir `/casas/{token}` (link recebido) → casa padrão provisionada automaticamente com itens iniciais e avatar renderizado.
- Coleta diária disponível (se não coletou hoje); vê saldo de moedas do grupo.

**Esperado** FR-001/002/003 e onboarding < 5 min (SC-001).

### 4. Comprar / colocar / mover / vender item

- Com saldo ≥ custo, comprar um item na loja (casa ou avatar), colocá-lo no grid, movê-lo, vender → fração creditada no saldo; ledger registra; saldo nunca negativo.
- Sem saldo → erro amigável, nada muda.

**Esperado** FR-002/003/006/007/009/010.

### 5. Avatar

- Equipar peça desbloqueada/comprada → avatar atualizado na própria casa e na casa de visitante.
- Equipar peça não desbloqueada/comprada → bloqueado com oferta de compra.
- Subir de nível (XP) → novas peças gratuitas desbloqueadas.

**Esperado** FR-011/012/013/014/015.

### 6. Visita + mural

- Membro do mesmo grupo abre casa de outro (via link da casa/portal do bairro), deixa recado → recado no mural do anfitrião.
- Teto diário de visitas: após N visitas, bloqueio com aviso.
- Casa de jogador de outro grupo ou link inválido → acesso negado.

**Esperado** FR-016/017/018.

### 7. Presente

- Visitante envia presente (item de avatar/decoração ou moedas) ao anfitrião → entrega automática + notificação; anfitrião vê e pode vender (fração).
- Item roubado não pode ser presenteado → bloqueado.

**Esperado** FR-019/020/021.

### 8. Roubo e segurança

- Casa alvo com segurança baixa (nível < `houseSecurityMaxLevel`): roubo com chance determinística (com `random` stub em teste) — sucesso transfere item decorativo com marca de roubado; falha → multa piso/teto + aumento de procurado (policeService).
- Segurança alta → bloqueado (não tenta). Cooldown/teto diário respeitado. Moedas/pets imunes. Item roubado não vendável/presenteável. Nunca kick/ban.

**Esperado** FR-021/022/023/024/025/026 e constituição II/III.

### 9. Regressão (nada quebrou)

- Comandos existentes do fun (property, coins, bolsa, shop etc.) continuam funcionando; `npm test` completo verde; build do dashboard verde; pipeline WhatsApp intacto (grupo + DM).

**Esperado** expansão sem quebrar (usuário + constituição).

## Comandos/resumo

| Ação | Comando | Saída esperada |
|------|---------|----------------|
| Testes | `npm test -- --test-name-pattern="houses\|avatar\|visit\|gift\|robbery\|token"` | pass |
| Build UI | `npm run fun:dashboard:build` | build ok |
| Sane module | `npm run fun:dev --setup` | setup ok |
| `/casa` grupo | msg no privado | instrução DM |
| `/casa` DM | link pessoal + resumo | link |
| Web | abrir `/casas/{token}` | casa provisionada |

## Observações

- Dados de teste sintéticos via scripts de limpeza existentes; nunca destruir estado de jogo real (constituição).
- A UI nova fica sob `/casas/*` (fora do admin, padrão bolsa); o middleware trata como público; tema claro/escuro preservado.