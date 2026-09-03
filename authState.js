/**
 * Compatibilidade para consumidores que ainda importam o adaptador de auth da
 * raiz. A implementação canônica suporta as chaves adicionais do Baileys v7.
 */
export { useSqliteAuthState } from './db/authState.js';
