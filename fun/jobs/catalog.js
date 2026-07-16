/**
 * Catálogo de profissões Fun (MVP: 3 cargos).
 * Salário base/dia no /daily; diluição por lotação no jobService.
 */

export const JOB_CATALOG = Object.freeze([
  {
    id: 'estagiario',
    name: 'Estagiário',
    emoji: '📎',
    description: 'CLT iniciante. Protocolo da impressora — fácil de passar.',
    baseSalary: 30,
    salaryFloor: 15,
    retryFee: 25,
    firstAttemptFree: true,
    difficulty: 'easy',
    game: 'printer',
    gameConfig: {
      durationMs: 60_000,
      targetScore: 8,
      maxMistakes: 3,
      maxScore: 20,
    },
  },
  {
    id: 'bombeiro',
    name: 'Bombeiro',
    emoji: '🚒',
    description: 'Bairro em chamas. Apague 20 focos em 90s — a pressão sobe com o tempo.',
    baseSalary: 50,
    salaryFloor: 25,
    retryFee: 40,
    firstAttemptFree: true,
    difficulty: 'medium',
    game: 'fire',
    gameConfig: {
      // longo o bastante pra a dificuldade escalar
      durationMs: 90_000,
      targetScore: 20,
      maxLostHouses: 3,
      maxScore: 50,
    },
  },
  {
    id: 'hacker',
    name: 'Hacker',
    emoji: '💻',
    description:
      'Quebra de firewall: 16 portas (até 9.999.999), 20s cada, teclado + CRACK, vírus nas laterais.',
    baseSalary: 80,
    salaryFloor: 40,
    retryFee: 60,
    firstAttemptFree: true,
    difficulty: 'hard',
    game: 'firewall',
    gameConfig: {
      // tempo total solto (cada porta tem 20s próprio)
      durationMs: 16 * 20_000 + 30_000,
      targetRounds: 16,
      maxHits: 3,
      maxConsecutiveMisses: 3,
      // 7 dígitos → mais tempo digitando no teclado
      numberMax: 9_999_999,
      portTimeMs: 20_000,
      maxScore: 16,
    },
  },
]);

export function getJob(id) {
  const key = String(id || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return (
    JOB_CATALOG.find(
      (j) =>
        j.id === key ||
        j.name
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '') === key
    ) || null
  );
}

export function listJobs() {
  return JOB_CATALOG.slice();
}

/**
 * Diluição: n pessoas no mesmo cargo no grupo.
 * 1→100% · 2→90% · 3→80% · 4→70% · 5+→60%
 */
export function salaryMultiplier(countInJob) {
  const n = Math.max(1, Math.floor(Number(countInJob) || 1));
  if (n <= 1) return 1;
  if (n === 2) return 0.9;
  if (n === 3) return 0.8;
  if (n === 4) return 0.7;
  return 0.6;
}

export function effectiveSalary(job, countInJob) {
  if (!job) return 0;
  const mult = salaryMultiplier(countInJob);
  const raw = Math.floor(Number(job.baseSalary) * mult);
  return Math.max(Number(job.salaryFloor) || 0, raw);
}
