# Contract — Dashboard: settings por grupo (persona_enabled)

Contrato da API de configurações por grupo do dashboard do módulo fun, estendido para a feature
Bot Membro Vivo. Backend: `fun/dashboard/server.js`. UI: `fun_dashboard/src/app/groups/page.tsx`.

## Endpoints

### `GET /api/fun/groups/:groupJid/settings`

Retorna as settings efetivas do grupo.

**Response 200**:

```json
{
  "groupJid": "120363000000000000@g.us",
  "settings": {
    "personaEnabled": true,
    "worldEventsEnabled": true,
    "cooldownMs": 60000,
    "...": "...campos existentes..."
  },
  "defaults": {}
}
```

### `PUT /api/fun/groups/:groupJid/settings`

Atualiza settings do grupo. Aceita subset dos campos; campos ausentes preservam o valor atual.

**Request body** (exemplo para a feature):

```json
{
  "personaEnabled": false
}
```

**Regras da feature**:
- `personaEnabled: true|1` → liga (default).
- `personaEnabled: false|0` → desliga.
- Ausente → preserva o valor atual (ou default **ligado** para grupos sem registro).
- `groupJid` deve terminar em `@g.us` (senão 400).

**Response 200**:

```json
{ "ok": true, "settings": { "personaEnabled": false, "...": "..." } }
```

**Response 400** (groupJid inválido): `{ "ok": false, "error": "groupJid invalido" }`

## Regra efetiva no runtime

A feature fica ativa em um grupo quando:
`groupSettings.persona_enabled !== 0 && funConfig.personaEnabled !== false`

Ou seja: o dashboard desliga por grupo (0), e a config global pode desligar tudo (false).

## Impacto na implementação

- `fun/db/funGroupRepository.js`: adicionar `persona_enabled` no mapa de colunas e no
  `upsertGroupSettings` (padrão "default ON").
- `fun/dashboard/server.js`: propagar `personaEnabled` do body para o `upsertGroupSettings` no
  handler de `PUT /api/fun/groups/:jid/settings`.
- `fun_dashboard/src/app/groups/page.tsx`: adicionar toggle "Persona (membro vivo)" que chama o PUT.
