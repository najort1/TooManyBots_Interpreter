import { useMemo, useState } from 'react';
import { buttonBaseClass, inputBaseClass, panelClass } from '../../../lib/uiTokens';
import type { SurveyFrequencyRules, SurveyQuestionDefinition, SurveyTypeDefinition } from '../../../types';
import { SurveyQuestionBuilder } from './SurveyQuestionBuilder';

interface SurveyEditorViewProps {
  survey?: SurveyTypeDefinition | null;
  busy?: boolean;
  onSave: (survey: {
    name: string;
    title: string;
    description: string;
    status: 'draft' | 'active' | 'inactive';
    questions: SurveyQuestionDefinition[];
    frequency: Partial<SurveyFrequencyRules>;
  }) => void;
  onCancel: () => void;
}

function initialQuestions(survey?: SurveyTypeDefinition | null): SurveyQuestionDefinition[] {
  const questions = Array.isArray(survey?.questions)
    ? survey.questions
    : (Array.isArray(survey?.schema?.questions) ? survey.schema.questions : []);
  return questions.length > 0
    ? questions.map((question, index) => ({
        id: String(question.id || `q_${index + 1}`),
        text: String(question.text || ''),
        type: String(question.type || 'text'),
        required: question.required !== false,
        maxLength: question.maxLength,
        scale: question.scale,
      }))
    : [{ id: 'q_1', text: '', type: 'nps', required: true, scale: { min: 0, max: 10 } }];
}

export function SurveyEditorView({ survey, busy = false, onSave, onCancel }: SurveyEditorViewProps) {
  const frequency = survey?.frequency || null;
  const [name, setName] = useState(String(survey?.name || ''));
  const [title, setTitle] = useState(String(survey?.title || survey?.schema?.title || survey?.name || ''));
  const [description, setDescription] = useState(String(survey?.description || survey?.schema?.description || ''));
  const [status, setStatus] = useState<'draft' | 'active' | 'inactive'>(
    survey?.status === 'active' || survey?.status === 'inactive' ? survey.status : 'draft'
  );
  const [questions, setQuestions] = useState<SurveyQuestionDefinition[]>(() => initialQuestions(survey));
  const [maxResponses, setMaxResponses] = useState(
    frequency?.maxResponsesPerUser == null ? '' : String(frequency.maxResponsesPerUser)
  );
  const [periodUnit, setPeriodUnit] = useState(String(frequency?.periodUnit || 'month'));
  const [periodValue, setPeriodValue] = useState(String(frequency?.periodValue || 1));
  const [minIntervalDays, setMinIntervalDays] = useState(
    String(frequency?.minIntervalDays ?? Math.floor(Number(frequency?.minIntervalSeconds || 0) / 86400))
  );
  const [skipForAdmins, setSkipForAdmins] = useState(Boolean(frequency?.skipForAdmins));

  const canSave = useMemo(() => {
    return name.trim().length > 0 && questions.some(question => String(question.text || '').trim());
  }, [name, questions]);

  const handleSave = () => {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      title: title.trim() || name.trim(),
      description: description.trim(),
      status,
      questions: questions.map((question, index) => ({
        ...question,
        id: String(question.id || `q_${index + 1}`).trim() || `q_${index + 1}`,
        text: String(question.text || '').trim(),
      })).filter(question => question.text),
      frequency: {
        maxResponsesPerUser: maxResponses ? Math.max(1, Math.floor(Number(maxResponses) || 1)) : null,
        periodUnit,
        periodValue: Math.max(1, Math.floor(Number(periodValue) || 1)),
        minIntervalSeconds: Math.max(0, Math.floor(Number(minIntervalDays) || 0)) * 24 * 60 * 60,
        skipForAdmins,
      },
    });
  };

  return (
    <article className={`${panelClass} space-y-4`}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-extrabold">{survey ? 'Editar Pesquisa' : 'Nova Pesquisa'}</h3>
          <p className="mt-1 max-w-3xl text-xs text-slate-500">
            Salvar deixa a pesquisa disponivel para um bloco survey no fluxo no-code ou para envio pela aba Disparo manual.
            Este editor nao envia mensagens sozinho.
          </p>
        </div>
        <select
          value={status}
          onChange={event => setStatus(event.target.value as 'draft' | 'active' | 'inactive')}
          className={`${inputBaseClass} w-[160px]`}
          disabled={busy}
        >
          <option value="draft">Rascunho</option>
          <option value="active">Ativa</option>
          <option value="inactive">Inativa</option>
        </select>
      </header>

      <label className="block">
        <span className="mb-1 block text-xs font-bold uppercase tracking-[0.06em] text-slate-500">Nome</span>
        <input
          type="text"
          value={name}
          onChange={event => setName(event.target.value)}
          className={`${inputBaseClass} w-full`}
          disabled={busy}
        />
      </label>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-[0.06em] text-slate-500">Titulo exibido ao usuario</span>
          <input
            type="text"
            value={title}
            onChange={event => setTitle(event.target.value)}
            className={`${inputBaseClass} w-full`}
            disabled={busy}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-[0.06em] text-slate-500">Descricao exibida antes da pesquisa</span>
          <textarea
            value={description}
            onChange={event => setDescription(event.target.value)}
            className={`${inputBaseClass} min-h-[92px] w-full resize-y`}
            disabled={busy}
            placeholder="Ex.: Queremos entender como foi seu atendimento. Leva menos de um minuto."
          />
        </label>
      </div>

      <section className="rounded-xl border border-[#dce6f3] bg-[#f8fbff] p-3">
        <div>
          <p className="m-0 text-sm font-semibold text-slate-700">Regras de frequencia</p>
          <p className="mt-1 text-xs text-slate-500">
            Controle quantas vezes o mesmo contato pode responder esta pesquisa e qual intervalo minimo deve existir entre respostas.
          </p>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,0.85fr)]">
          <div className="rounded-lg border border-[#dce6f3] bg-white p-3">
            <p className="m-0 text-xs font-bold uppercase tracking-[0.06em] text-slate-500">Limite por contato</p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_92px_minmax(0,120px)]">
              <label className="block">
                <span className="mb-1 block text-xs text-slate-500">Maximo de respostas</span>
                <input
                  type="number"
                  min={1}
                  value={maxResponses}
                  onChange={event => setMaxResponses(event.target.value)}
                  className={`${inputBaseClass} w-full`}
                  placeholder="Sem limite"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-slate-500">A cada</span>
                <input
                  type="number"
                  min={1}
                  value={periodValue}
                  onChange={event => setPeriodValue(event.target.value)}
                  className={`${inputBaseClass} w-full`}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-slate-500">Periodo</span>
                <select value={periodUnit} onChange={event => setPeriodUnit(event.target.value)} className={`${inputBaseClass} w-full`}>
                  <option value="hour">Hora(s)</option>
                  <option value="day">Dia(s)</option>
                  <option value="week">Semana(s)</option>
                  <option value="month">Mes(es)</option>
                  <option value="year">Ano(s)</option>
                </select>
              </label>
            </div>
          </div>
          <div className="rounded-lg border border-[#dce6f3] bg-white p-3">
            <p className="m-0 text-xs font-bold uppercase tracking-[0.06em] text-slate-500">Intervalo minimo</p>
            <label className="mt-2 block">
              <span className="mb-1 block text-xs text-slate-500">Dias entre uma resposta e outra</span>
              <input
                type="number"
                min={0}
                value={minIntervalDays}
                onChange={event => setMinIntervalDays(event.target.value)}
                className={`${inputBaseClass} w-full`}
                placeholder="0"
              />
            </label>
          </div>
        </div>
        <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={skipForAdmins} onChange={event => setSkipForAdmins(event.target.checked)} />
          Ignorar regras para administradores
        </label>
      </section>

      <SurveyQuestionBuilder questions={questions} onChange={setQuestions} />

      <footer className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className={`${buttonBaseClass} border-[#d4e0f1] bg-white text-slate-700 hover:bg-slate-50`}
          onClick={onCancel}
          disabled={busy}
        >
          Cancelar
        </button>
        <button
          type="button"
          className={`${buttonBaseClass} border-[#174d9d] bg-[#1e63c9] text-white hover:bg-[#174d9d]`}
          onClick={handleSave}
          disabled={busy || !canSave}
        >
          {busy ? 'Salvando...' : 'Salvar pesquisa'}
        </button>
      </footer>
    </article>
  );
}
