import { panelClass } from '../../lib/uiTokens';
import { EmptyStateMascot } from '../feedback/EmptyStateMascot';

export function SurveyEmptyState() {
  return (
    <section className={panelClass}>
      <EmptyStateMascot
        title="Nenhuma pesquisa registrada ainda"
        description="Assim que os blocos de survey forem executados no runtime, os indicadores aparecerao aqui em tempo real."
      />
    </section>
  );
}
