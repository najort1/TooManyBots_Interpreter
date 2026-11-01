/**
 * Focus trap mínimo e sem dependências, compartilhado entre Dialog e o drawer
 * do AppShell: lista os focáveis de um container e cicla Tab/Shift+Tab dentro dele.
 */

export const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focáveis (na ordem do DOM) dentro de `container`. */
export function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

/**
 * Cicla Tab dentro de `container`: Shift+Tab no primeiro vai para o último,
 * Tab no último volta para o primeiro e foco fora do container é puxado de volta.
 * Retorna true quando o evento foi consumido (preventDefault aplicado).
 */
export function trapTabKey(
  event: Pick<KeyboardEvent, "key" | "shiftKey"> & { preventDefault(): void },
  container: HTMLElement
): boolean {
  if (event.key !== "Tab") return false;
  const focusables = getFocusable(container);
  if (focusables.length === 0) return false;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !container.contains(active))) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && (active === last || !container.contains(active))) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
