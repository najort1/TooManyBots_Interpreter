// Seed manual: registra o Almoço do siqueira (mensagem enviada em 01/09/2026)
// como evento ativo no grupo, com lembrete principal (3 dias antes + 3 horas
// antes) e lembrete custom de "confirma presença até 20/09 20:00".
//
// Execução:
//   node scripts/seed-event-almoco.js
//
// O id do grupo é fixo (120363390006674987@g.us) e o autor é registrado como
// "siqueira@s.whatsapp.net" — sem JID real, esse valor é apenas um placeholder
// para organização da autoria do registro.

import { peekFunDataDirFromDisk } from '../fun/config.js';

// O banco fixa TMB_DATA_DIR no carregamento do módulo. Alinha o seed ao mesmo
// diretório isolado que `fun/start.js` usa, antes de importar a camada de banco.
process.env.TMB_DATA_DIR = peekFunDataDirFromDisk();

const [
  { initDb },
  { createEventRepository },
  { createEventFingerprint, zonedLocalDateTimeToMs },
] = await Promise.all([
  import('../db/index.js'),
  import('../fun/db/eventRepository.js'),
  import('../fun/events/eventTime.js'),
]);

await initDb();
const repository = createEventRepository();

const SCOPE_KEY = '120363390006674987@g.us';
const AUTHOR_JID = 'siqueira@s.whatsapp.net';
const SOURCE_MESSAGE_ID = 'seed-almoco-2026-09-26';
const TIMEZONE = 'America/Sao_Paulo';

const eventStartsAt = zonedLocalDateTimeToMs({
  date: '2026-09-26',
  time: '12:00',
  timeZone: TIMEZONE,
});
const confirmDueAt = zonedLocalDateTimeToMs({
  date: '2026-09-20',
  time: '20:00',
  timeZone: TIMEZONE,
});

if (!eventStartsAt) {
  throw new Error('Não foi possível resolver startsAt — verifique timezone e data.');
}
if (!confirmDueAt) {
  throw new Error('Não foi possível resolver confirmDueAt — verifique timezone e data.');
}

const items = [
  'Brownie',
  'Tortinha de limão e doce de leite',
  'Vinagrete',
  'Salpicão',
  'Creme de galinha',
];

const result = repository.upsertEvent({
  event: {
    scopeKey: SCOPE_KEY,
    authorJid: AUTHOR_JID,
    sourceMessageId: SOURCE_MESSAGE_ID,
    title: 'Almoção',
    eventType: 'almoço',
    startsAt: eventStartsAt,
    timezone: TIMEZONE,
    location: 'Laje',
    items,
    organizerName: 'Siqueira',
    organizerJid: AUTHOR_JID,
    fingerprint: createEventFingerprint({
      title: 'Almoção',
      eventType: 'almoço',
      date: '2026-09-26',
      time: '12:00',
      location: 'Laje',
    }),
    extraction: {
      source: 'manual-seed',
      confidence: 100,
      notes: 'Mensagem original enviada por siqueira em 01/09/2026; horário do almoço assumido 12:00.',
      rawAction: 'create',
    },
  },
  sourceMessageIds: [SOURCE_MESSAGE_ID],
  reminderSchedule: {
    threeDaysEnabled: true,
    threeHoursEnabled: true,
    customReminders: [
      { key: 'confirmar-presenca', dueAt: confirmDueAt, enabled: true },
    ],
  },
  now: Date.now(),
});

if (!result.ok) {
  console.error('Falha ao registrar evento:', result);
  process.exit(1);
}

console.log('Banco Fun:', process.env.TMB_DATA_DIR);
console.log('Evento registrado:', JSON.stringify({
  id: result.event.id,
  scopeKey: result.event.scopeKey,
  startsAt: new Date(result.event.startsAt).toISOString(),
  confirmDueAt: new Date(confirmDueAt).toISOString(),
  created: result.created,
  duplicate: result.duplicate,
}, null, 2));

const due = repository.listDueReminders({ scopeKey: SCOPE_KEY, now: eventStartsAt + 1_000 });
console.log('Lembretes pendentes (com now > startsAt):');
for (const entry of due) {
  console.log(`  ${entry.reminder.reminderKind} due=${new Date(entry.reminder.dueAt).toISOString()}`);
}
