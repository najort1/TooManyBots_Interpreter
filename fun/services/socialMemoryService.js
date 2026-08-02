const sensitive = /(senha|password|token|api[_-]?key|pix|cpf|telefone|celular|endereço|endereco)/iu;
const words = (text) => String(text || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];

export function createSocialMemoryService() {
  function observe(event = {}) {
    const text = String(event.text || '').trim();
    const participants = [...new Set([event.authorJid, ...(event.mentionedJids || [])].map(String).filter(Boolean))];
    if (!event.scopeKey || sensitive.test(text)) return { scopeKey: String(event.scopeKey || ''), participants: [], topic: '', style: [] };
    const vocabulary = words(text);
    const style = vocabulary.some((word) => ['kkkk', 'haha', 'meme', 'zoeira'].includes(word)) ? ['bem-humorado', 'leve']
      : vocabulary.some((word) => ['ajuda', 'dúvida', 'duvida', 'obrigado'].includes(word)) ? ['prestativo', 'respeitoso']
        : ['direto', 'respeitoso'];
    return { scopeKey: String(event.scopeKey), participants, topic: vocabulary.slice(0, 6).join(' '), style };
  }
  function toIdentityInput(signal = {}) {
    const topic = String(signal.topic || '').trim();
    return { voiceStyle: Array.isArray(signal.style) ? signal.style : [], groupLoreSummary: topic ? `Temas recorrentes: ${topic}` : '' };
  }
  return { observe, toIdentityInput };
}
