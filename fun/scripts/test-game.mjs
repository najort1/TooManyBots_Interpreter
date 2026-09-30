#!/usr/bin/env node

/**
 * Gerador de Link de Testes Instantâneo para os Jogos Multiplayer de Panelinhas.
 *
 * Cria automaticamente:
 * 1. Duas contas de teste válidas no /cadastrar (jogador1 e jogador2 com senha123)
 * 2. Duas panelinhas rivais (Piratas do Zap 🏴‍☠️ e Ninjas do Bot 🥷)
 * 3. Uma sala de jogo pronta para teste com link dinâmico (Cloudflare Quick Tunnel ou localhost)
 *
 * Uso:
 *   node fun/scripts/test-game.mjs quiz     # Inicia sala de Quiz Royale com IA
 *   node fun/scripts/test-game.mjs ctf      # Inicia sala de Grid CTF (Capture a Bandeira)
 *   node fun/scripts/test-game.mjs hill     # Inicia sala de King of the Hill (Domínio)
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FUN_DIR = path.resolve(__dirname, '..');
const FUN_USER_CONFIG_PATH = path.join(FUN_DIR, 'config.user.json');
const FUN_DEFAULT_DATA_DIR = path.resolve(FUN_DIR, '..', 'data', 'fun');

function resolveDataDir() {
  if (process.env.TMB_DATA_DIR) {
    return path.resolve(String(process.env.TMB_DATA_DIR).trim());
  }
  if (fs.existsSync(FUN_USER_CONFIG_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(FUN_USER_CONFIG_PATH, 'utf-8'));
      const custom = String(parsed?.dataDir ?? '').trim();
      if (custom) return path.resolve(custom);
    } catch {}
  }
  return FUN_DEFAULT_DATA_DIR;
}

// Configura o diretório de dados SQLite antes de importar os repositórios
const dataDir = resolveDataDir();
process.env.TMB_DATA_DIR = dataDir;
fs.mkdirSync(dataDir, { recursive: true });

const { initDb } = await import('../../db/index.js');
const { getDb } = await import('../../db/context.js');
const { ensureFunSchema } = await import('../schema.js');
const { createFunAccountRepository } = await import('../db/funAccountRepository.js');
const { createFunFactionRepository } = await import('../db/funFactionRepository.js');
const { GAME_TYPES, GAME_METADATA } = await import('../games/gameManager.js');
const { DEFAULT_GAME_TEST_KEY } = await import('../games/routes.js');
const { resolveFunConfig, loadFunUserConfig } = await import('../config.js');
const { getPublicBaseUrl } = await import('../utils/publicUrl.js');

await initDb();
const db = getDb();
ensureFunSchema(db);

const userCfg = loadFunUserConfig();
const funConfig = resolveFunConfig(userCfg);

// Mapeamento do modo de jogo pelo argumento da linha de comando
const argMode = String(process.argv[2] || 'quiz').toLowerCase().trim();
let chosenGameType = GAME_TYPES.QUIZ_ROYALE;

if (['ctf', 'bandeira', 'grid', 'grid_ctf'].includes(argMode)) {
  chosenGameType = GAME_TYPES.GRID_CTF;
} else if (['hill', 'king', 'koth', 'dominio', 'king_of_the_hill'].includes(argMode)) {
  chosenGameType = GAME_TYPES.KING_OF_THE_HILL;
} else {
  chosenGameType = GAME_TYPES.QUIZ_ROYALE;
}

const meta = GAME_METADATA[chosenGameType];

// Escopo isolado exclusivo para testes locais (NUNCA usa grupos reais da whitelist para nao poluir nem enviar mensagens)
const scopeKey = '120363020000000000@g.us';

const accountRepo = createFunAccountRepository({ getDatabase: getDb });
const factionRepo = createFunFactionRepository({ getDatabase: getDb });

// 1. Cria ou reutiliza contas de teste para login
const userJid1 = '5511999990001@s.whatsapp.net';
const userJid2 = '5511999990002@s.whatsapp.net';

if (!accountRepo.getByUserJid(userJid1)) {
  try {
    accountRepo.createAccount({
      userJid: userJid1,
      username: 'jogador1',
      password: 'senha123',
      pin: '1234',
    });
  } catch {}
}

if (!accountRepo.getByUserJid(userJid2)) {
  try {
    accountRepo.createAccount({
      userJid: userJid2,
      username: 'jogador2',
      password: 'senha123',
      pin: '1234',
    });
  } catch {}
}

// 2. Cria ou reutiliza as duas panelinhas rivais no grupo
let facPiratas = factionRepo.getByName(scopeKey, 'Piratas do Zap');
if (!facPiratas) {
  const res = factionRepo.createFaction({
    scopeKey,
    name: 'Piratas do Zap',
    leaderJid: userJid1,
  });
  facPiratas = res.faction;
}

let facNinjas = factionRepo.getByName(scopeKey, 'Ninjas do Bot');
if (!facNinjas) {
  const res = factionRepo.createFaction({
    scopeKey,
    name: 'Ninjas do Bot',
    leaderJid: userJid2,
  });
  facNinjas = res.faction;
}

// Garante que jogador1 está nos Piratas e jogador2 nos Ninjas
if (!factionRepo.getMember(scopeKey, userJid1)) {
  factionRepo.joinFaction({ scopeKey, userJid: userJid1, factionId: facPiratas.id });
}
if (!factionRepo.getMember(scopeKey, userJid2)) {
  factionRepo.joinFaction({ scopeKey, userJid: userJid2, factionId: facNinjas.id });
}

// 3. Verifica se a API do bot já está rodando na porta 8790
async function isServerRunning(port = 8790) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/fun/health`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

const serverActive = await isServerRunning(8790);
const isUsingDefaultKey = !process.env.FUN_GAME_TEST_KEY;
const gameTestKey = String(process.env.FUN_GAME_TEST_KEY || DEFAULT_GAME_TEST_KEY).trim() || DEFAULT_GAME_TEST_KEY;

if (!serverActive) {
  console.error('\n[ERRO] A API Fun nao esta rodando na porta 8790.');
  console.error('   Inicie o bot com `npm run fun` e execute este script novamente.\n');
  process.exit(1);
}

if (isUsingDefaultKey) {
  console.log('[INFO] Usando chave mockada padrao para testes locais.');
}

let roomId = null;
let gameLink = null;
const publicBaseUrl = getPublicBaseUrl(funConfig);

try {
  const res = await fetch('http://127.0.0.1:8790/api/fun/games/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Game-Test-Key': gameTestKey,
    },
    body: JSON.stringify({
      scopeKey,
      gameType: chosenGameType,
      prize: 1000,
      startInMinutes: 5,
      announce: false,
      isTest: true,
      force: true,
    }),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.ok || !data.room?.id) {
    const cause = data.error || data.reason || `HTTP ${res.status}`;
    console.error(`\n[ERRO] A API Fun recusou criar a sala de teste (${cause}).`);
    if (cause === 'test_room_creation_forbidden') {
      console.error('   Se a API Fun ja estava em execucao antes desta alteracao, reinicie o bot (`npm run fun`)');
      console.error('   para carregar o suporte a chave mockada padrao de testes.\n');
    } else {
      console.error('   Confirme que o processo Fun foi reiniciado apos atualizar o codigo.\n');
    }
    process.exit(1);
  }

  roomId = data.room.id;
  gameLink = data.gameLink || `${publicBaseUrl}/jogos/${roomId}`;

  // Nunca imprime URL até confirmar que a mesma instância de API conhece a sala.
  const roomCheck = await fetch(`http://127.0.0.1:8790/api/fun/games/room/${roomId}`);
  if (!roomCheck.ok) {
    console.error('\n❌ A sala foi criada mas não pôde ser encontrada na API Fun ativa.');
    console.error('   Link não será exibido para evitar um erro 404 no navegador.\n');
    process.exit(1);
  }
} catch (err) {
  console.error(`\n❌ Não foi possível criar ou validar a sala de teste: ${err?.message || err}\n`);
  process.exit(1);
}

// 4. Exibe banner com os links e credenciais prontas
console.log('\n' + '═'.repeat(66));
console.log(` 🎮 SALA DE TESTE PRONTA: ${meta.name.toUpperCase()} ${meta.emoji}`);
console.log(' 🔇 Modo de teste isolado: mensagens para o WhatsApp desativadas.');
console.log('═'.repeat(66));
console.log(`\n🔗 LINK DO JOGO (Abra no navegador):`);
console.log(`   👉 \x1b[36m${gameLink}\x1b[0m`);
console.log(`   Ou localmente: \x1b[33mhttp://localhost:3001/jogos/${roomId}\x1b[0m\n`);

console.log('👥 CONTAS DE TESTE PRONTAS PARA LOGIN:');
console.log('─'.repeat(66));
console.log(` 👤 Jogador 1: \x1b[32mjogador1\x1b[0m   | Senha: \x1b[32msenha123\x1b[0m`);
console.log(`    Panelinha: 🏴‍☠️ Piratas do Zap (Líder)`);
console.log('─'.repeat(66));
console.log(` 👤 Jogador 2: \x1b[35mjogador2\x1b[0m   | Senha: \x1b[35msenha123\x1b[0m`);
console.log(`    Panelinha: 🥷 Ninjas do Bot (Líder)`);
console.log('─'.repeat(66));

console.log('\n💡 DICA DE TESTE:');
console.log(' • Abra 2 abas no navegador (uma normal e outra anônima) ou no celular.');
console.log(' • Faça login com "jogador1" em uma aba e "jogador2" na outra.');
console.log(' • Ambas as panelinhas estarão no lobby disputando o prêmio de 1000 moedas!');
console.log('═'.repeat(66) + '\n');

process.exit(0);
