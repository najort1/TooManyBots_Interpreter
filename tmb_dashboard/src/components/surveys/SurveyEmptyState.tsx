import { panelClass } from '../../lib/uiTokens';
import { EmptyStateMascot } from '../feedback/EmptyStateMascot';

export function SurveyEmptyState() {
  return (
    <section className={panelClass}>
      <EmptyStateMascot
        title="Nenhuma pesquisa registrada ainda"
        description="Os indicadores aparecem depois que uma pesquisa for enviada por um bloco survey no fluxo ou pela aba Disparo manual e o usuario responder no WhatsApp."
      />
    </section>
  );
}
