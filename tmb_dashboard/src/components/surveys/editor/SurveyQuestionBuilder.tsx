import { buttonBaseClass, inputBaseClass, timelineItemClass } from '../../../lib/uiTokens';
import type { SurveyQuestionDefinition } from '../../../types';

type QuestionType = 'text' | 'nps' | 'scale_0_5' | 'boolean';

interface SurveyQuestionBuilderProps {
  questions: SurveyQuestionDefinition[];
  onChange: (questions: SurveyQuestionDefinition[]) => void;
}

const questionTypes: Array<{ value: QuestionType; label: string }> = [
  { value: 'text', label: 'Texto' },
  { value: 'nps', label: 'NPS 0-10' },
  { value: 'scale_0_5', label: 'Escala 0-5' },
  { value: 'boolean', label: 'Sim/Nao' },
];

function createQuestion(index: number): SurveyQuestionDefinition {
  return {
    id: `q_${index + 1}`,
    text: '',
    type: 'text',
    required: true,
  };
}

export function SurveyQuestionBuilder({ questions, onChange }: SurveyQuestionBuilderProps) {
  const updateQuestion = (index: number, patch: Partial<SurveyQuestionDefinition>) => {
    onChange(questions.map((question, currentIndex) => (
      currentIndex === index ? { ...question, ...patch } : question
    )));
  };

  return (
    <div className="space-y-2">
      {questions.map((question, index) => (
        <div key={question.id || index} className={`${timelineItemClass} space-y-2`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="text-sm text-slate-700">Pergunta {index + 1}</strong>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={question.required !== false}
                  onChange={event => updateQuestion(index, { required: event.target.checked })}
                />
                Obrigatoria
              </label>
              <button
                type="button"
                className={`${buttonBaseClass} border-[#f2c4ca] bg-[#fff5f5] text-[#b4232c] hover:bg-[#ffe4e6]`}
                onClick={() => onChange(questions.filter((_, currentIndex) => currentIndex !== index))}
                disabled={questions.length <= 1}
                title="Remover pergunta"
              >
                <i className="fa-regular fa-trash-can" aria-hidden="true" />
              </button>
            </div>
          </div>

          <input
            type="text"
            value={question.text}
            onChange={event => updateQuestion(index, { text: event.target.value })}
            className={`${inputBaseClass} w-full`}
            placeholder="Texto da pergunta"
          />

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[180px_1fr]">
            <select
              value={String(question.type || 'text')}
              onChange={event => updateQuestion(index, { type: event.target.value })}
              className={`${inputBaseClass} w-full`}
            >
              {questionTypes.map(item => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>

            {question.type === 'text' ? (
              <input
                type="number"
                min={0}
                value={question.maxLength || ''}
                onChange={event => updateQuestion(index, {
                  maxLength: event.target.value ? Math.max(1, Math.floor(Number(event.target.value) || 0)) : undefined,
                })}
                className={`${inputBaseClass} w-full`}
                placeholder="Limite de caracteres opcional"
              />
            ) : (
              <div className="flex items-center rounded-xl border border-[#dce6f3] bg-[#f8fbff] px-3 text-xs text-slate-600">
                {question.type === 'nps'
                  ? 'Valida respostas numericas de 0 a 10.'
                  : question.type === 'scale_0_5'
                    ? 'Valida respostas numericas de 0 a 5.'
                    : 'Aceita sim/nao e 1/0.'}
              </div>
            )}
          </div>
        </div>
      ))}

      <button
        type="button"
        className={`${buttonBaseClass} border-[#d4e0f1] bg-white text-slate-700 hover:bg-slate-50`}
        onClick={() => onChange([...questions, createQuestion(questions.length)])}
      >
        <i className="fa-solid fa-plus" aria-hidden="true" />
        Adicionar pergunta
      </button>
    </div>
  );
}
