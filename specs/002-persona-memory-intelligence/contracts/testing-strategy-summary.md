# Validação implementada

A cobertura determinística usa `node:test` e SQLite inicializado pelo ambiente de teste. Os cenários verificam prioridade de reply, expiração de thread, ranking e isolamento por `scope_key`, supressão de memória sensível, separação entre fatos confirmados e inferidos, e identidade independente por grupo.

# Testing Strategy Summary

## Matriz de testes

- Unitários para classificação, ranking, confidence, decay e resolução de thread
- Integração para persistência SQLite, isolamento por `scope_key`, ingestão e retrieval
- Contratos para formato do pacote de contexto, descarte e pós-resposta
- Comportamento/regressão para reply continuity, anti-leak entre grupos e uso de fatos confirmados vs inferidos

## Gates obrigatórios

- inferido não pode sobrescrever explícito
- reply deve priorizar a thread citada
- memórias de um grupo não podem ser usadas em outro grupo
- memórias sensíveis não entram no pacote de resposta
- fallback da persona continua funcionando com contexto insuficiente

## Observabilidade esperada

- memórias ingeridas, descartadas e selecionadas
- razão de descarte
- thread usada
- bloqueios por sensibilidade
- bloqueios por mismatch de escopo
