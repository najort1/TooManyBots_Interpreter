import test from 'node:test';
import assert from 'node:assert/strict';

import { initDb } from '../db/index.js';
import { getDb } from '../db/context.js';
import {
  createGeminiTtsService,
  normalizeSpeechConfig,
  formatMultiSpeakerPrompt,
  GEMINI_TTS_VOICES,
} from '../fun/services/geminiTtsService.js';
import {
  buildNewsAudioTranscript,
  synthesizeNewsAudio,
  sendNewsAudioWithRetry,
  enforceAudioScriptCap,
} from '../fun/services/news/newsAudio.js';
import { createFunNewsRepository } from '../fun/db/funNewsRepository.js';
import { createFunJournalMessageRepository } from '../fun/db/funJournalMessageRepository.js';
import { createFunSnapshotRepository } from '../fun/db/funSnapshotRepository.js';
import { createNewsService } from '../fun/services/newsService.js';

await initDb();

function uniqueGroup() {
  return `120363${String(Date.now()).slice(-10)}${Math.floor(Math.random() * 90 + 10)}@g.us`;
}

test('geminiTtsService: normalizeSpeechConfig suporta single-speaker e multi-speaker flexível', () => {
  // 1. Single voice default e customizado
  const defaultConf = normalizeSpeechConfig();
  assert.equal(defaultConf.isMultiSpeaker, false);
  assert.equal(defaultConf.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Puck');

  const singleConf = normalizeSpeechConfig({ voiceName: 'Zephyr' });
  assert.equal(singleConf.isMultiSpeaker, false);
  assert.equal(singleConf.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Zephyr');

  // 2. Multi-speaker com array de strings
  const multiArrayStr = normalizeSpeechConfig({ voices: ['Puck', 'Zephyr'] });
  assert.equal(multiArrayStr.isMultiSpeaker, true);
  const speakers1 = multiArrayStr.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs;
  assert.equal(speakers1.length, 2);
  assert.equal(speakers1[0].speaker, 'Speaker 1');
  assert.equal(speakers1[0].voiceConfig.prebuiltVoiceConfig.voiceName, 'Puck');
  assert.equal(speakers1[1].speaker, 'Speaker 2');
  assert.equal(speakers1[1].voiceConfig.prebuiltVoiceConfig.voiceName, 'Zephyr');

  // 3. Multi-speaker com array de objetos
  const multiArrayObj = normalizeSpeechConfig({
    voices: [
      { speaker: 'Speaker 1', voiceName: 'Fenrir' },
      { speaker: 'Speaker 2', voiceName: 'Aoede' },
    ],
  });
  assert.equal(multiArrayObj.isMultiSpeaker, true);
  const speakers2 = multiArrayObj.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs;
  assert.equal(speakers2[0].speaker, 'Speaker 1');
  assert.equal(speakers2[0].voiceConfig.prebuiltVoiceConfig.voiceName, 'Fenrir');
  assert.equal(speakers2[1].speaker, 'Speaker 2');
  assert.equal(speakers2[1].voiceConfig.prebuiltVoiceConfig.voiceName, 'Aoede');

  // 4. Multi-speaker com mapa de objetos
  const multiMap = normalizeSpeechConfig({
    speakers: {
      'Speaker 1': 'Charon',
      'Speaker 2': 'Kore',
    },
  });
  assert.equal(multiMap.isMultiSpeaker, true);
  const speakers3 = multiMap.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs;
  assert.equal(speakers3.length, 2);
  assert.equal(speakers3[0].voiceConfig.prebuiltVoiceConfig.voiceName, 'Charon');
  assert.equal(speakers3[1].voiceConfig.prebuiltVoiceConfig.voiceName, 'Kore');

  // 5. Array de 1 voz sem forceMultiSpeaker vira single voice
  const singleFromArray = normalizeSpeechConfig({ voices: ['Aoede'] });
  assert.equal(singleFromArray.isMultiSpeaker, false);
  assert.equal(singleFromArray.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Aoede');
});

test('geminiTtsService: formatMultiSpeakerPrompt gera cabeçalhos de áudio, notas do diretor e transcrição', () => {
  const prompt = formatMultiSpeakerPrompt({
    audioProfile: {
      'Speaker 1': 'Main news anchor',
      'Speaker 2': 'Resident comedian',
    },
    directorNote: {
      'Speaker 1': 'Style: Sarcastic. Pace: Fast.',
      'Speaker 2': 'Style: Outraged.',
    },
    scene: 'Late-night radio station at 23:59',
    sampleContext: 'Brazilian Portuguese satirical news podcast',
    transcript: [
      { speaker: 'Speaker 1', tone: 'enthusiastic', text: 'Boa noite grupo!' },
      { speaker: 'Speaker 2', tone: 'angry', text: 'Que palhaçada foi essa hoje?' },
    ],
  });

  assert.match(prompt, /# Audio Profile/);
  assert.match(prompt, /For Speaker 1: Main news anchor/);
  assert.match(prompt, /For Speaker 2: Resident comedian/);
  assert.match(prompt, /# Director's note/);
  assert.match(prompt, /## Scene:/);
  assert.match(prompt, /## Transcript:/);
  assert.match(prompt, /Speaker 1: \[enthusiastic\] Boa noite grupo!/);
  assert.match(prompt, /Speaker 2: \[angry\] Que palhaçada foi essa hoje\?/);
});

test('geminiTtsService: synthesize envia payload multi-speaker e concatena múltiplos parts de áudio', async () => {
  let capturedRequest = null;
  const mockPart1 = Buffer.from('pcm-chunk-1').toString('base64');
  const mockPart2 = Buffer.from('pcm-chunk-2').toString('base64');

  const ttsService = createGeminiTtsService({
    apiKey: 'test-api-key',
    generateClient: () => ({
      models: {
        generateContent: async (request) => {
          capturedRequest = request;
          return {
            candidates: [
              {
                content: {
                  parts: [
                    { inlineData: { data: mockPart1, mimeType: 'audio/L16;rate=24000' } },
                    { inlineData: { data: mockPart2, mimeType: 'audio/L16;rate=24000' } },
                  ],
                },
              },
            ],
          };
        },
      },
    }),
    audioTranscoder: {
      toOggOpus: async (wavBuffer) => {
        // Confirma que o buffer recebido contém os dois chunks concatenados
        assert.ok(wavBuffer.includes(Buffer.from('pcm-chunk-1')));
        assert.ok(wavBuffer.includes(Buffer.from('pcm-chunk-2')));
        return Buffer.from('mock-ogg-opus-multi-speaker');
      },
    },
  });

  assert.equal(ttsService.isAvailable(), true);

  const result = await ttsService.synthesize('Speaker 1: Olá\nSpeaker 2: Opa', {
    voices: [
      { speaker: 'Speaker 1', voiceName: GEMINI_TTS_VOICES.PUCK },
      { speaker: 'Speaker 2', voiceName: GEMINI_TTS_VOICES.ZEPHYR },
    ],
  });

  assert.equal(result.ok, true);
  assert.equal(result.isMultiSpeaker, true);
  assert.equal(result.mimeType, 'audio/ogg; codecs=opus');
  assert.equal(result.buffer.toString(), 'mock-ogg-opus-multi-speaker');

  // Valida que o config enviado ao SDK continha multiSpeakerVoiceConfig
  assert.ok(capturedRequest.config.speechConfig.multiSpeakerVoiceConfig);
  const cfgs = capturedRequest.config.speechConfig.multiSpeakerVoiceConfig.speakerVoiceConfigs;
  assert.equal(cfgs.length, 2);
  assert.equal(cfgs[0].voiceConfig.prebuiltVoiceConfig.voiceName, 'Puck');
  assert.equal(cfgs[1].voiceConfig.prebuiltVoiceConfig.voiceName, 'Zephyr');
});

test('newsAudio: buildNewsAudioTranscript monta roteiro dramático sem formatação bruta de WhatsApp', () => {
  const commentator = {
    name: 'Cachorro Chupetinha',
    title: 'fiscal de vergonha alheia',
    style: 'sarcástico, canino e debochado',
    voiceName: 'Zephyr',
    voiceTone: 'Vocal Smile, high pitched, cynical and sarcastic bark tone',
    catchphrase: 'Au au au, essa vergonha eu não passo nem de coleira!',
  };

  const edition = {
    capa: '*O Grande Escândalo do Pix Falso*',
    intro: 'Eduardo e Lucas passaram a tarde inteira _discutindo_ uma cobrança indevida.',
    comentarista: 'Eu achei tudo um absurdo sem tamanho!',
    detalhes: '• Nos bastidores da redação, a confusão só aumentou com cada print.',
    citacoes: 'Eduardo: “@123 quem vai pagar essa conta?”',
    foreshadow: '_Amanhã o Serasa bate na porta do grupo._',
  };

  const transcriptData = buildNewsAudioTranscript({
    edition,
    commentator,
    conversation: { quiet: false },
  });

  assert.ok(transcriptData);
  assert.equal(transcriptData.speakers.length, 2);
  assert.equal(transcriptData.speakers[0].speaker, 'Speaker 1');
  assert.equal(transcriptData.speakers[0].voiceName, 'Puck');
  assert.equal(transcriptData.speakers[1].speaker, 'Speaker 2');
  assert.equal(transcriptData.speakers[1].voiceName, 'Zephyr');

  // Garante que a transcrição não possui asteriscos nem underlines
  assert.doesNotMatch(transcriptData.prompt, /\*O Grande/);
  assert.doesNotMatch(transcriptData.prompt, /_discutindo_/);
  assert.match(transcriptData.prompt, /O Grande Escândalo do Pix Falso/);
  assert.match(transcriptData.prompt, /Au au au, essa vergonha eu não passo nem de coleira!/);
  assert.match(transcriptData.prompt, /Cachorro Chupetinha/);
});

test('newsAudio: buildNewsAudioTranscript lida com edição calma (Plantão do Silêncio)', () => {
  const commentator = {
    name: 'Craque Neto do Zap',
    catchphrase: 'É uma barbaridade!',
    voiceName: 'Fenrir',
  };

  const transcriptData = buildNewsAudioTranscript({
    edition: {},
    commentator,
    conversation: { quiet: true },
  });

  assert.match(transcriptData.prompt, /Plantão do Silêncio/);
  assert.match(transcriptData.prompt, /Até eu cochilei na redação hoje!/);
  assert.match(transcriptData.prompt, /É uma barbaridade!/);
});

test('newsService: tryPublish sintetiza e retorna áudio multi-voz com a edição do jornal', async () => {
  const scope = uniqueGroup();
  const newsRepository = createFunNewsRepository({ getDatabase: getDb });
  const journalMessageRepository = createFunJournalMessageRepository({ getDatabase: getDb });
  const snapshotRepository = createFunSnapshotRepository({ getDatabase: getDb });
  const now = Date.UTC(2026, 8, 8, 23, 59, 30);

  journalMessageRepository.recordMessage({
    scopeKey: scope,
    messageId: 'msg-1',
    authorJid: 'marcos@s.whatsapp.net',
    text: 'A aposta de hoje vai dar bom demais.',
    now: now - 8_000,
  });
  journalMessageRepository.recordMessage({
    scopeKey: scope,
    messageId: 'msg-2',
    authorJid: 'felipe@s.whatsapp.net',
    text: 'Vai perder até a cueca de novo.',
    now: now - 6_000,
  });
  journalMessageRepository.recordMessage({
    scopeKey: scope,
    messageId: 'msg-3',
    authorJid: 'marcos@s.whatsapp.net',
    text: 'Confia na call que o green vem.',
    now: now - 4_000,
  });
  journalMessageRepository.recordMessage({
    scopeKey: scope,
    messageId: 'msg-4',
    authorJid: 'felipe@s.whatsapp.net',
    text: 'Não dou dez minutos pro loss chegar.',
    now: now - 2_000,
  });

  let ttsCalled = false;
  let receivedPrompt = '';
  let receivedVoices = null;

  const mockTtsService = {
    isAvailable: () => true,
    synthesize: async (textOrOptions, options = {}) => {
      ttsCalled = true;
      receivedPrompt = typeof textOrOptions === 'string' ? textOrOptions : textOrOptions.text;
      receivedVoices = options.voices || textOrOptions.voices;
      return {
        ok: true,
        buffer: Buffer.from('synthetic-newspaper-audio-ogg'),
        mimeType: 'audio/ogg; codecs=opus',
      };
    },
  };

  const newsService = createNewsService({
    newsRepository,
    journalMessageRepository,
    snapshotRepository,
    ttsService: mockTtsService,
    getContactDisplayName: (jid) => ({ 'marcos@s.whatsapp.net': 'Marcos', 'felipe@s.whatsapp.net': 'Felipe' })[jid],
    flavorService: {
      async line() {
        return [
          'CAPA: A Ilusão do Green Noturno',
          'INTRO: Marcos tentou convencer o grupo de que sua aposta era infalível.',
          'COMENTARISTA: Eu já vi esse filme e o final é sempre no vermelho!',
          'DETALHES: Felipe previu o desastre iminente enquanto Marcos insistia na sorte.',
          'FORESHADOW: Amanhã saberemos quem ficou sem saldo na carteira.',
        ].join('\n');
      },
      lastProvider: () => 'zen',
    },
  });

  const published = await newsService.tryPublish(
    scope,
    {
      groupNewsEnabled: true,
      groupNewsAudioEnabled: true,
      worldTimezone: 'UTC',
      groupNewsHour: 23,
      groupNewsMinute: 59,
    },
    now
  );

  assert.equal(published.ok, true);
  assert.equal(ttsCalled, true, 'Deveria ter executado a síntese de áudio');
  assert.ok(published.audioBuffer, 'Deveria conter o buffer do áudio');
  assert.equal(published.audioBuffer.toString(), 'synthetic-newspaper-audio-ogg');
  assert.equal(published.audioMimeType, 'audio/ogg; codecs=opus');
  assert.match(receivedPrompt, /A Ilusão do Green Noturno/);
  assert.ok(Array.isArray(receivedVoices) && receivedVoices.length === 2);
  assert.equal(receivedVoices[0].speaker, 'Speaker 1');
  assert.equal(receivedVoices[1].speaker, 'Speaker 2');
});

test('sendNewsAudioWithRetry: recupera com sucesso na 3ª tentativa após 2 falhas de rede', async () => {
  let callCount = 0;
  const mockSock = {
    sendMessage: async (jid, payload) => {
      callCount += 1;
      if (callCount < 3) {
        throw new Error(`Socket timeout temporário na tentativa ${callCount}`);
      }
      return { status: 'sent', jid, payload };
    },
  };

  const delaysLogged = [];
  const fakeSleep = async (ms) => {
    delaysLogged.push(ms);
  };

  const result = await sendNewsAudioWithRetry(
    mockSock,
    '120363test@g.us',
    { audioBuffer: Buffer.from('audio-bytes'), audioMimeType: 'audio/ogg; codecs=opus' },
    { maxAttempts: 3, delays: [10, 20], sleepFn: fakeSleep, logger: { warn: () => {} } }
  );

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 3);
  assert.equal(callCount, 3);
  assert.deepEqual(delaysLogged, [10, 20]);
});

test('sendNewsAudioWithRetry: desiste e retorna falha controlada após esgotar 3 tentativas', async () => {
  let callCount = 0;
  const mockSock = {
    sendMessage: async () => {
      callCount += 1;
      throw new Error('Falha permanente de conexão');
    },
  };

  const result = await sendNewsAudioWithRetry(
    mockSock,
    '120363test@g.us',
    { audioBuffer: Buffer.from('audio-bytes'), audioMimeType: 'audio/ogg; codecs=opus' },
    { maxAttempts: 3, delays: [0, 0], sleepFn: async () => {}, logger: { warn: () => {} } }
  );

  assert.equal(result.ok, false);
  assert.equal(callCount, 3);
  assert.match(result.reason, /Falha permanente de conexão/);
});

test('synthesizeNewsAudio: realiza retentativa automática com sucesso se a 1ª chamada ao TTS falhar', async () => {
  let callCount = 0;
  const mockTtsService = {
    isAvailable: () => true,
    synthesize: async () => {
      callCount += 1;
      if (callCount === 1) {
        return { ok: false, reason: 'rate-limit-exceeded' };
      }
      return {
        ok: true,
        buffer: Buffer.from('audio-succeeded-on-retry'),
        mimeType: 'audio/ogg; codecs=opus',
      };
    },
  };

  const delaysLogged = [];
  const fakeSleep = async (ms) => {
    delaysLogged.push(ms);
  };

  const result = await synthesizeNewsAudio({
    edition: { capa: 'Teste', intro: 'Intro' },
    commentator: { name: 'Doutor Fuxico', voiceName: 'Kore' },
    ttsService: mockTtsService,
    maxAttempts: 3,
    delays: [15, 30],
    sleepFn: fakeSleep,
    logger: { warn: () => {} },
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts, 2);
  assert.equal(callCount, 2);
  assert.equal(result.buffer.toString(), 'audio-succeeded-on-retry');
  assert.deepEqual(delaysLogged, [15]);
});

test('buildNewsAudioTranscript: âncora introduz nominalmente o comentarista com gancho fluido', () => {
  const commentator = {
    name: 'Doutor Fuxico',
    title: 'psicanalista de boteco',
    voiceName: 'Kore',
    catchphrase: 'O quadro clínico é grave.',
  };

  const transcriptData = buildNewsAudioTranscript({
    edition: {
      capa: 'Plantão do Deboche',
      intro: 'O grupo passou a tarde rindo de memes.',
      comentarista: 'Isso é pura falta de lote pra capinar.',
    },
    commentator,
    conversation: { mood: 'zoeiro' },
  });

  const anchorTurn = transcriptData.turns.find((t) => t.speaker === 'Speaker 1');
  const commentatorTurn = transcriptData.turns.find((t) => t.speaker === 'Speaker 2');

  assert.ok(anchorTurn);
  assert.ok(commentatorTurn);
  // O âncora deve convocar nominalmente o comentarista
  assert.match(anchorTurn.text, /Doutor Fuxico/);
  assert.match(anchorTurn.text, /chamo nosso comentarista residente, Doutor Fuxico/);
  // O comentarista deve responder com actingTone zoeiro
  assert.equal(commentatorTurn.tone, 'debochado e gargalhando');
  assert.match(commentatorTurn.text, /Olha, ouvindo tudo isso eu só digo uma coisa/);
});

test('newsAudio: buildNewsAudioTranscript limita texto total a no máximo 680 caracteres para garantir áudio < 1m20s', () => {
  const commentator = {
    name: 'Fiscal do Rolo',
    title: 'auditor de confusões',
    voiceName: 'Fenrir',
    catchphrase: 'Aqui tem esquema, eu sinto o cheiro de longe!',
  };

  const edition = {
    capa: 'O Escândalo dos Empréstimos Sem Volta no Grupo do WhatsApp Que Parou a Cidade Inteira',
    intro: 'A apuração jornalística revelou detalhes impressionantes sobre as transações financeiras suspeitas.',
    comentarista: 'Eu analisei os números e digo com toda certeza: a conta nunca vai fechar desse jeito!',
    detalhes: 'Vários membros foram confrontados nos bastidores e ninguém soube explicar o sumiço dos comprovantes.',
    foreshadow: 'Amanhã os cobradores baterão na porta do grupo exigindo explicações.',
  };

  const transcriptData = buildNewsAudioTranscript({
    edition,
    commentator,
    conversation: { mood: 'movimentado' },
    funConfig: { groupNewsAudioMaxChars: 680 },
  });

  const totalChars = transcriptData.turns.reduce((acc, t) => acc + (t?.text?.length || 0), 0);
  assert.ok(
    totalChars <= 680,
    `Total de caracteres falados (${totalChars}) deve ser <= 680 para garantir áudio < 1m20s`
  );
  // Garante que é um podcast enxuto com 3 a 5 turnos
  assert.ok(transcriptData.turns.length >= 3 && transcriptData.turns.length <= 5);
});

test('newsAudio: enforceAudioScriptCap reduz turnos excedentes mantendo coerência', () => {
  const turns = [
    { speaker: 'Speaker 1', text: 'Texto longo do âncora '.repeat(20) },
    { speaker: 'Speaker 2', text: 'Texto longo do comentarista '.repeat(20) },
  ];

  const capped = enforceAudioScriptCap(turns, 400);
  const total = capped.reduce((acc, t) => acc + t.text.length, 0);
  assert.ok(total <= 400, `Deveria limitar a 400 caracteres, mas teve ${total}`);
});
