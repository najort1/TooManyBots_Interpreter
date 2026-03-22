/**
 * engine/flowEngine.js
 *
 * Interpretador principal. Dada uma sessão e uma mensagem recebida,
 * este módulo impulsiona o fluxo bloco por bloco.
 */

import { HANDLERS } from '../handlers/index.js';
import { getSession, createSession, updateSession, deleteSession } from '../db/index.js';

/**
 * Ponto de entrada principal chamado a cada mensagem recebida do WhatsApp.
 *
 * @param {object} sock    - Socket Baileys
 * @param {string} jid     - JID do remetente (telefone@s.whatsapp.net)
 * @param {string} message - texto normalizado da mensagem recebida
 * @param {string} listId  - ID da linha da lista selecionada (se houver)
 * @param {object} flow    - { blocks, blockMap, indexMap }
 */
export async function handleIncoming(sock, jid, message, listId, flow) {
  let session = getSession(jid);

  // ── Novo usuário: criar sessão e começar do bloco 0 ──────────────────────
  if (!session || session.status === 'ended') {
    session = createSession(jid);
  }

  // ── Usuário respondeu enquanto esperava ────────────────────────────────────────────
  if (session.waitingFor === 'keyword') {
    session = await resolveKeywordWait(sock, jid, message, session, flow);
    if (!session) return; // resolução consumiu a mensagem, irá executar o motor novamente
  } else if (session.waitingFor === 'list') {
    session = await resolveListWait(sock, jid, message, listId, session, flow);
    if (!session) return;
  }

  // ── Executar o motor a partir do índice do bloco atual ───────────────────────────────
  await runEngine(sock, jid, session, flow);
}

// ─── Loop do motor ─────────────────────────────────────────────────────────────

async function runEngine(sock, jid, session, flow) {
  const MAX_STEPS = 100; // segurança — prevenir loops infinitos
  let steps = 0;

  while (steps < MAX_STEPS) {
    steps++;

    if (session.blockIndex >= flow.blocks.length) {
      console.log(`[Motor] ${jid} alcançou o final do fluxo.`);
      updateSession(jid, { status: 'ended' });
      return;
    }

    if (session.status === 'ended') {
      return;
    }

    const block = flow.blocks[session.blockIndex];

    if (!block) {
      console.warn(`[Motor] Nenhum bloco no índice ${session.blockIndex} para ${jid}`);
      return;
    }

    const handler = HANDLERS[block.type];

    if (!handler) {
      console.warn(`[Motor] Nenhum manipulador para o tipo de bloco "${block.type}" — ignorando.`);
      updateSession(jid, { blockIndex: session.blockIndex + 1 });
      session = getSession(jid);
      continue;
    }

    console.log(`[Motor] ${jid} | bloco[${session.blockIndex}] tipo="${block.type}" id="${block.id}"`);

    let result;
    try {
      result = await handler({ block, session, sock, jid, flow });
    } catch (err) {
      console.error(`[Motor] Erro no manipulador "${block.type}":`, err);
      return;
    }

    // Aplicar patch da sessão
    const patch = {
      ...(result.sessionPatch ?? {}),
      blockIndex: result.nextBlockIndex ?? session.blockIndex,
    };

    updateSession(jid, patch);
    session = getSession(jid);

    // Manipulador disse "concluído" ou "aguardar usuário"
    if (result.done) {
      deleteSession(jid); // limpar após o fim da conversa
      return;
    }

    if (result.nextBlockIndex === null) {
      // Aguardando entrada do usuário — parar o loop
      return;
    }
  }

  console.error(`[Motor] ${jid} atingiu MAX_STEPS (${MAX_STEPS}). Possível loop infinito no fluxo.`);
}

// ─── Resolvedores de espera ───────────────────────────────────────────────────────────

async function resolveKeywordWait(sock, jid, message, session, flow) {
  const rawKeywords = session.variables.__keywords;
  const nextIndex = parseInt(session.variables.__nextBlockOnKeyword ?? '0', 10);

  if (!rawKeywords) {
    // Nenhuma palavra-chave configurada — qualquer resposta avança
    clearWait(jid, session, nextIndex);
    return getSession(jid);
  }

  const keywordDefs = JSON.parse(rawKeywords);
  const normalizedMsg = message.toLowerCase().trim();
  let matched = false;

  for (const def of keywordDefs) {
    const keywords = String(def.keyword)
      .split(',')
      .map(k => k.trim().toLowerCase());

    const isMatch = keywords.some(k => normalizedMsg === k || normalizedMsg.includes(k));

    if (isMatch) {
      matched = true;
      if (def.response) {
        await sock.sendMessage(jid, { text: def.response });
      }
      break;
    }
  }

  // Armazenar a mensagem bruta do usuário como variável para blocos de condição
  const variables = {
    ...session.variables,
    __lastMessage: message,
    __keywords: undefined,
    __nextBlockOnKeyword: undefined,
  };

  updateSession(jid, {
    blockIndex:  matched ? nextIndex : nextIndex, // sempre avançar após bloco de palavra-chave
    waitingFor: null,
    variables,
  });

  return getSession(jid);
}

async function resolveListWait(sock, jid, message, listId, session, flow) {
  const nextIndex = parseInt(session.variables.__nextBlockOnList ?? '0', 10);
  const rawItems  = session.variables.__listItems;

  let selectedTitle = message;
  let selectedId    = listId;

  // Tentar corresponder por ID primeiro (seleção de lista nativa), fallback para correspondência de texto
  if (rawItems) {
    const items = JSON.parse(rawItems);
    const match = items.find(item =>
      item.id === listId ||
      String(item.title).toLowerCase() === message.toLowerCase()
    );
    if (match) {
      selectedTitle = match.title;
      selectedId    = match.id;
    }
  }

  const variables = {
    ...session.variables,
    __lastListSelection:      selectedTitle,
    __lastListSelectionId:    selectedId,
    __listItems:              undefined,
    __nextBlockOnList:        undefined,
  };

  updateSession(jid, {
    blockIndex:  nextIndex,
    waitingFor: null,
    variables,
  });

  return getSession(jid);
}

function clearWait(jid, session, nextIndex) {
  updateSession(jid, {
    blockIndex:  nextIndex,
    waitingFor: null,
  });
}
