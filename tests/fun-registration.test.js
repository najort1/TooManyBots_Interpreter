import test from 'node:test';
import assert from 'node:assert/strict';
import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import {
  createFunAccountRepository,
  hashSecret,
  verifySecret,
} from '../fun/db/funAccountRepository.js';
import {
  createRegistrationService,
  validateUsername,
  validatePassword,
  validatePin,
  REGISTRATION_STEPS,
} from '../fun/services/registrationService.js';
import { createFunModule, resolveFunConfig } from '../fun/index.js';
import { FUN_COMMANDS } from '../fun/constants.js';

await initDb();

function uniqueJid(prefix = '5511') {
  return `${prefix}${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 900 + 100)}@s.whatsapp.net`;
}

function uniqueUsername(prefix = 'user_') {
  return `${prefix}${String(Date.now()).slice(-6)}_${Math.floor(Math.random() * 900 + 100)}`;
}

test('Validações utilitárias: username, password e PIN', () => {
  // Username
  assert.equal(validateUsername('ab').ok, false);
  assert.equal(validateUsername('user name').ok, false);
  assert.equal(validateUsername('user@invalid').ok, false);
  assert.equal(validateUsername('valid_user123').ok, true);
  assert.equal(validateUsername('ALICE_99').ok, true);

  // Password
  assert.equal(validatePassword('12345').ok, false);
  assert.equal(validatePassword('   ').ok, false);
  assert.equal(validatePassword('a'.repeat(129)).ok, false);
  assert.equal(validatePassword('a'.repeat(128)).ok, true);
  assert.equal(validatePassword('senhaSegura123').ok, true);

  // PIN (4 dígitos numéricos)
  assert.equal(validatePin('123').ok, false);
  assert.equal(validatePin('12345').ok, false);
  assert.equal(validatePin('123a').ok, false);
  assert.equal(validatePin('abcd').ok, false);
  assert.equal(validatePin('0000').ok, true);
  assert.equal(validatePin('1234').ok, true);
  assert.equal(validatePin('9876').ok, true);
});

test('funAccountRepository: criação, busca, unicidade, senhas e PINs com hash seguro', () => {
  const repo = createFunAccountRepository({ getDatabase: getDb });
  repo.ensureSchema();

  const userJid = uniqueJid();
  const username = uniqueUsername();

  // Criação
  const created = repo.createAccount({
    userJid,
    username,
    password: 'MinhaSenhaForte!',
    pin: '4321',
  });

  assert.equal(created.userJid, userJid);
  assert.equal(created.username, username);
  assert.equal(created.status, 'active');

  // Busca por JID
  const byJid = repo.getByUserJid(userJid);
  assert.ok(byJid);
  assert.equal(byJid.username, username);

  // Busca por username (case insensitive)
  const byName = repo.getByUsername(username.toUpperCase());
  assert.ok(byName);
  assert.equal(byName.userJid, userJid);

  // Unicidade
  assert.equal(repo.usernameExists(username), true);
  assert.equal(repo.usernameExists(username.toUpperCase()), true);
  assert.equal(repo.usernameExists('usuario_inexistente_xyz_999'), false);
  // Excluindo o próprio usuário da checagem
  assert.equal(repo.usernameExists(username, userJid), false);

  // Verificação de senha
  assert.equal(repo.verifyPassword(byJid, 'MinhaSenhaForte!'), true);
  assert.equal(repo.verifyPassword(byJid, 'senha_errada'), false);

  // Verificação de PIN
  assert.equal(repo.verifyPin(byJid, '4321'), true);
  assert.equal(repo.verifyPin(byJid, '0000'), false);

  // Atualização de senha
  assert.equal(repo.updatePassword(userJid, 'NovaSenhaUltraSegura@2026'), true);
  const updatedPass = repo.getByUserJid(userJid);
  assert.equal(repo.verifyPassword(updatedPass, 'NovaSenhaUltraSegura@2026'), true);
  assert.equal(repo.verifyPassword(updatedPass, 'MinhaSenhaForte!'), false);

  // Atualização de PIN
  assert.equal(repo.updatePin(userJid, '8888'), true);
  const updatedPin = repo.getByUserJid(userJid);
  assert.equal(repo.verifyPin(updatedPin, '8888'), true);
  assert.equal(repo.verifyPin(updatedPin, '4321'), false);

  // Limpeza
  repo.deleteAccount(userJid);
  assert.equal(repo.getByUserJid(userJid), null);
});

test('registrationService: fluxo completo de cadastro em DM (usuário -> senha -> PIN 4 dígitos)', async () => {
  const accountRepo = createFunAccountRepository({ getDatabase: getDb });
  const service = createRegistrationService({ accountRepository: accountRepo });

  const userJid = uniqueJid();
  const username = uniqueUsername();

  // 1. Tentar iniciar em grupo deve ser bloqueado por segurança
  const groupAttempt = await service.startRegistration({ userJid, isGroup: true });
  assert.equal(groupAttempt.ok, false);
  assert.equal(groupAttempt.error, 'group_not_allowed');

  // 2. Iniciar no privado (DM)
  const start = await service.startRegistration({ userJid, isGroup: false });
  assert.equal(start.ok, true);
  assert.equal(start.isExisting, false);
  assert.equal(service.hasActiveSession(userJid), true);

  // 3. Etapa 1: Enviar username inválido
  const step1Invalid = await service.handleIncomingMessage({
    userJid,
    text: 'ab', // menos de 3 caracteres
  });
  assert.equal(step1Invalid.handled, true);
  assert.equal(step1Invalid.error, 'invalid_username');

  // 4. Etapa 1: Enviar username válido
  const step1Valid = await service.handleIncomingMessage({
    userJid,
    text: username,
  });
  assert.equal(step1Valid.handled, true);
  assert.match(step1Valid.message, /senha/i);

  // 5. Etapa 2: Enviar senha inválida (muito curta)
  const step2Invalid = await service.handleIncomingMessage({
    userJid,
    text: '123',
  });
  assert.equal(step2Invalid.handled, true);
  assert.equal(step2Invalid.error, 'invalid_password');

  // 6. Etapa 2: Enviar senha válida
  const step2Valid = await service.handleIncomingMessage({
    userJid,
    text: 'senhaSegura123',
  });
  assert.equal(step2Valid.handled, true);
  assert.match(step2Valid.message, /código validador de 4 dígitos/i);

  // 7. Etapa 3: Enviar PIN inválido (5 dígitos ou não numérico)
  const step3Invalid = await service.handleIncomingMessage({
    userJid,
    text: '12345',
  });
  assert.equal(step3Invalid.handled, true);
  assert.equal(step3Invalid.error, 'invalid_pin');

  // 8. Etapa 3: Enviar PIN válido de 4 dígitos
  const step3Valid = await service.handleIncomingMessage({
    userJid,
    text: '9988',
  });
  assert.equal(step3Valid.handled, true);
  assert.equal(step3Valid.completed, true);
  assert.match(step3Valid.message, /Cadastro realizado com sucesso/i);

  // Sessão deve ter sido limpa após finalizar
  assert.equal(service.hasActiveSession(userJid), false);

  // Conta deve estar persistida no banco
  const saved = accountRepo.getByUserJid(userJid);
  assert.ok(saved);
  assert.equal(saved.username, username);
  assert.equal(accountRepo.verifyPassword(saved, 'senhaSegura123'), true);
  assert.equal(accountRepo.verifyPin(saved, '9988'), true);

  // 9. Se o usuário digitar /cadastrar novamente, deve informar que já tem cadastro
  const reStart = await service.startRegistration({ userJid, isGroup: false });
  assert.equal(reStart.ok, true);
  assert.equal(reStart.isExisting, true);
  assert.match(reStart.message, /Você já possui uma conta cadastrada/i);
  assert.match(reStart.message, /alterar sua senha/i);
  assert.match(reStart.message, /alterar seu PIN/i);

  // Limpeza
  accountRepo.deleteAccount(userJid);
});

test('registrationService: cancelamento de sessão no privado com "cancelar"', async () => {
  const accountRepo = createFunAccountRepository({ getDatabase: getDb });
  const service = createRegistrationService({ accountRepository: accountRepo });
  const userJid = uniqueJid();

  await service.startRegistration({ userJid, isGroup: false });
  assert.equal(service.hasActiveSession(userJid), true);

  const cancelRes = await service.handleIncomingMessage({
    userJid,
    text: 'cancelar',
  });

  assert.equal(cancelRes.handled, true);
  assert.equal(cancelRes.canceled, true);
  assert.match(cancelRes.message, /cancelado com sucesso/i);
  assert.equal(service.hasActiveSession(userJid), false);
});

test('registrationService: alteração de senha e PIN de conta existente', async () => {
  const accountRepo = createFunAccountRepository({ getDatabase: getDb });
  const service = createRegistrationService({ accountRepository: accountRepo });
  const userJid = uniqueJid();
  const username = uniqueUsername();

  accountRepo.createAccount({
    userJid,
    username,
    password: 'senhaOriginal123',
    pin: '1111',
  });

  // Tenta alterar a senha
  await service.startRegistration({ userJid, isGroup: false });
  // Escolhe '1' (alterar senha)
  const opt1 = await service.handleIncomingMessage({ userJid, text: '1' });
  assert.match(opt1.message, /digite seu \*PIN atual de 4 dígitos\*/i);

  // Digita PIN errado
  const wrongPin = await service.handleIncomingMessage({ userJid, text: '9999' });
  assert.equal(wrongPin.error, 'wrong_pin');

  // Digita PIN correto
  const rightPin = await service.handleIncomingMessage({ userJid, text: '1111' });
  assert.match(rightPin.message, /PIN confirmado com sucesso/i);

  // Fornece nova senha
  const newPassRes = await service.handleIncomingMessage({ userJid, text: 'novaSenhaSecreta456' });
  assert.equal(newPassRes.completed, true);
  assert.match(newPassRes.message, /Sua senha foi alterada com sucesso/i);

  // Verifica que nova senha está ativa
  const accUpdated = accountRepo.getByUserJid(userJid);
  assert.equal(accountRepo.verifyPassword(accUpdated, 'novaSenhaSecreta456'), true);
  assert.equal(accountRepo.verifyPassword(accUpdated, 'senhaOriginal123'), false);

  // Agora testa alterar o PIN
  await service.startRegistration({ userJid, isGroup: false });
  // Escolhe '2' (alterar PIN)
  const opt2 = await service.handleIncomingMessage({ userJid, text: '2' });
  assert.match(opt2.message, /digite sua \*senha atual\*/i);

  // Digita senha correta
  const rightPass = await service.handleIncomingMessage({ userJid, text: 'novaSenhaSecreta456' });
  assert.match(rightPass.message, /Senha confirmada com sucesso/i);

  // Digita novo PIN
  const newPinRes = await service.handleIncomingMessage({ userJid, text: '7777' });
  assert.equal(newPinRes.completed, true);
  assert.match(newPinRes.message, /Seu PIN de 4 dígitos foi alterado com sucesso/i);

  const accPinUpdated = accountRepo.getByUserJid(userJid);
  assert.equal(accountRepo.verifyPin(accPinUpdated, '7777'), true);
  assert.equal(accountRepo.verifyPin(accPinUpdated, '1111'), false);

  accountRepo.deleteAccount(userJid);
});

test('Integração de ponta a ponta via funModule.onIncomingMessage', async () => {
  const sentMessages = [];
  const fakeSock = {
    user: { id: 'bot@s.whatsapp.net' },
    sendMessage: async (to, msg) => {
      sentMessages.push({ to, msg });
      return { key: { id: 'msg-' + Date.now() } };
    },
  };

  const funModule = createFunModule({
    getConfig: () => resolveFunConfig({ enabled: true, allowDm: true }),
    sendText: async (sock, jid, text) => {
      sentMessages.push({ jid, text });
      return { key: { id: 'text-' + Date.now() } };
    },
  });
  funModule.init();

  const userJid = uniqueJid();
  const username = uniqueUsername();

  // 1. Usuário envia /cadastrar no privado
  const r1 = await funModule.onIncomingMessage({
    sock: fakeSock,
    chatJid: userJid,
    actorJid: userJid,
    isGroup: false,
    text: '/cadastrar',
  });
  assert.equal(r1.handled, true);
  assert.ok(sentMessages.length > 0);
  assert.match(sentMessages[sentMessages.length - 1].text, /Cadastro no Fun Bot/i);

  // 2. Usuário envia nome de usuário no privado (mensagem normal sem barra)
  const r2 = await funModule.onIncomingMessage({
    sock: fakeSock,
    chatJid: userJid,
    actorJid: userJid,
    isGroup: false,
    text: username,
  });
  assert.equal(r2.handled, true);
  assert.match(sentMessages[sentMessages.length - 1].text, /Agora digite a sua \*senha\*/i);

  // 3. Usuário envia senha no privado
  const r3 = await funModule.onIncomingMessage({
    sock: fakeSock,
    chatJid: userJid,
    actorJid: userJid,
    isGroup: false,
    text: 'senhaForte2026',
  });
  assert.equal(r3.handled, true);
  assert.match(sentMessages[sentMessages.length - 1].text, /código validador de 4 dígitos/i);

  // 4. Usuário envia PIN de 4 dígitos no privado
  const r4 = await funModule.onIncomingMessage({
    sock: fakeSock,
    chatJid: userJid,
    actorJid: userJid,
    isGroup: false,
    text: '2026',
  });
  assert.equal(r4.handled, true);
  assert.match(sentMessages[sentMessages.length - 1].text, /Cadastro realizado com sucesso/i);

  // Verifica persistência via módulo
  const acc = funModule._services.accountRepository.getByUserJid(userJid);
  assert.ok(acc);
  assert.equal(acc.username, username);
  assert.equal(funModule._services.accountRepository.verifyPassword(acc, 'senhaForte2026'), true);
  assert.equal(funModule._services.accountRepository.verifyPin(acc, '2026'), true);

  funModule._services.accountRepository.deleteAccount(userJid);
});

test('registrationService: bloqueio e encerramento de sessão após 3 tentativas inválidas de autenticação', async () => {
  const accountRepo = createFunAccountRepository({ getDatabase: getDb });
  const service = createRegistrationService({ accountRepository: accountRepo });
  const userJid = uniqueJid();

  accountRepo.createAccount({
    userJid,
    username: uniqueUsername(),
    password: 'senhaOriginal123',
    pin: '1234',
  });

  await service.startRegistration({ userJid, isGroup: false });
  // Escolhe alterar senha (opção 1)
  await service.handleIncomingMessage({ userJid, text: '1' });

  // Tentativa 1 de PIN incorreto
  const t1 = await service.handleIncomingMessage({ userJid, text: '0001' });
  assert.equal(t1.error, 'wrong_pin');
  assert.equal(service.hasActiveSession(userJid), true);

  // Tentativa 2 de PIN incorreto
  const t2 = await service.handleIncomingMessage({ userJid, text: '0002' });
  assert.equal(t2.error, 'wrong_pin');
  assert.equal(service.hasActiveSession(userJid), true);

  // Tentativa 3 de PIN incorreto -> deve cancelar a sessão
  const t3 = await service.handleIncomingMessage({ userJid, text: '0003' });
  assert.equal(t3.error, 'max_attempts_exceeded');
  assert.match(t3.message, /Limite de tentativas/i);
  assert.equal(service.hasActiveSession(userJid), false);

  accountRepo.deleteAccount(userJid);
});

test('registrationService: expiração e pruning de sessões por TTL', async () => {
  const accountRepo = createFunAccountRepository({ getDatabase: getDb });
  const service = createRegistrationService({
    accountRepository: accountRepo,
    sessionTtlMs: 100, // 100ms
  });
  const userJid = uniqueJid();

  const now = 1000000;
  await service.startRegistration({ userJid, isGroup: false, now });
  assert.equal(service.hasActiveSession(userJid, now + 50), true);
  // Após 150ms expirou
  assert.equal(service.hasActiveSession(userJid, now + 150), false);
});

test('registrationService: alerta ao receber comando com barra durante o cadastro ativo sem cancelar a sessão', async () => {
  const accountRepo = createFunAccountRepository({ getDatabase: getDb });
  const service = createRegistrationService({ accountRepository: accountRepo });
  const userJid = uniqueJid();

  await service.startRegistration({ userJid, isGroup: false });
  assert.equal(service.hasActiveSession(userJid), true);

  // Usuário envia /menu em vez de nome de usuário
  const res = await service.handleIncomingMessage({ userJid, text: '/menu' });
  assert.equal(res.handled, true);
  assert.equal(res.error, 'command_during_registration');
  assert.match(res.message, /Você enviou um comando enquanto o seu cadastro está em andamento/i);
  // Sessão continua ativa para o usuário prosseguir
  assert.equal(service.hasActiveSession(userJid), true);
});

