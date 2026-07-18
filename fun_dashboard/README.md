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
  app/           # rotas (overview, ranking, bolsa, casino, groups, settings)
  components/    # shell, métricas, bolsa, tabelas, forms, ui
  hooks/         # estado de scope/grupo
  lib/           # api client, types, format, cn
```

## Bolsa / Corretora (read-only · isolada do admin)

Superfície **separada** do dashboard ops (sem sidebar, sem seletor de grupo, sem API key).

| Rota | Auth | Uso |
|------|------|-----|
| `/bolsa/<id>` | **Público** | Link que o bot manda no grupo |
| `/bolsa` | Público | Mensagem “use o link do zap” — **não lista grupos** |

- **Mobile:** coluna única compacta (mantida).  
- **Desktop (`lg+`):** terminal 3 colunas — empresas · gráfico protagonista · notícias/radar/heatmap.  
- Favoritos (localStorage), toolbar de ranges, cards densos, modal jornal.  
- **Não há compra/venda no site** — só visualização.  
- Trade: WhatsApp (`/bolsa comprar|vender`).  

### Decision brief (DME)

- **Task:** corretora read-only dedicada (não ops)  
- **Audience:** membros do grupo  
- **Platform:** web calmer mobile · desktop dense tools  
- **Palette:** peace gray + profundidade zinc-950/900/800  
- **Protagonist desktop:** gráfico + preço  
- **Privacidade:** link já carrega o grupo; zero seletor  



## Tema claro / escuro

- Toggle em **todas as superfícies** (sidebar ops + corretora pública).
- Preferência em `localStorage` (`fun-dashboard-theme`).
- Boot script no `<html>` evita flash; classe `.dark` + `dark:` Tailwind.
- Primeira visita: segue `prefers-color-scheme` do SO.

## Decisão DME (ops geral)

- **Work object:** grupo + jogadores  
- **Padrão:** command center (métricas + ranks + settings)  
- **Palette:** zinc / peace gray (+ dark zinc-950)  
- **Platform:** web calmo  


