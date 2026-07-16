# Fun Dashboard (Next.js)

UI operacional do bot Fun — **DME peace gray**, App Router, TypeScript, Tailwind.

A API continua no processo do bot (`fun/dashboard/server.js`, porta **8790**).  
Este app só consome `/api/fun/*` (rewrite no `next.config.ts`).

## Subir

```bash
# terminal 1 — bot + API
npm run fun

# terminal 2 — UI Next
npm run fun:dashboard
```

- UI: http://127.0.0.1:3001  
- API: http://127.0.0.1:8790/api/fun/health  

Opcional: `FUN_API_URL=http://127.0.0.1:8790` (default).

## Scripts

```bash
npm --prefix fun_dashboard run dev
npm --prefix fun_dashboard run build
npm --prefix fun_dashboard run start
```

## Estrutura

```
src/
  app/           # rotas (overview, ranking, casino, groups, settings)
  components/    # shell, métricas, tabelas, forms, ui
  hooks/         # estado de scope/grupo
  lib/           # api client, types, format, cn
```

## Decisão DME

- **Work object:** grupo + jogadores  
- **Padrão:** command center (métricas + ranks + settings)  
- **Palette:** zinc / peace gray  
- **Platform:** web calmo  
