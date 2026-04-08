import { useEffect, useRef } from 'react';

export interface Select2Option {
  value: string;
  label: string;
}

interface Select2ElementHandle {
  hasClass: (className: string) => boolean;
  select2: (...args: unknown[]) => Select2ElementHandle;
  val: (value?: string) => unknown;
  trigger: (eventName: string) => Select2ElementHandle;
  on: (eventName: string, handler: () => void) => Select2ElementHandle;
  off: (eventName: string, handler: () => void) => Select2ElementHandle;
}

type JQuerySelect2Factory = ((element: HTMLSelectElement) => Select2ElementHandle) & {
  fn?: { select2?: unknown };
};

interface Select2FieldProps {
  value: string;
  onChange: (value: string) => void;
  options: Select2Option[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  searchMinResults?: number;
}

function getJQueryFactory(): JQuerySelect2Factory | undefined {
  const win = window as Window & { jQuery?: JQuerySelect2Factory; $?: JQuerySelect2Factory };
  return win.jQuery || win.$;
}

export function Select2Field({
  value,
  onChange,
  options,
  placeholder = '',
  disabled = false,
  className = '',
  searchMinResults = 8,
}: Select2FieldProps) {
  const selectRef = useRef<HTMLSelectElement | null>(null);

  useEffect(() => {
    const element = selectRef.current;
    if (!element) return;

    const jq = getJQueryFactory();
    if (!jq?.fn?.select2) return;

    const $select = jq(element);
    if ($select.hasClass('select2-hidden-accessible')) {
      $select.select2('destroy');
    }

    $select.select2({
      width: '100%',
      placeholder,
      minimumResultsForSearch: searchMinResults,
      selectionCssClass: 'select2-tmb-selection',
      dropdownCssClass: 'select2-tmb-dropdown',
    });

    $select.val(value || '');
    $select.trigger('change.select2');

    const handleSelectChange = () => {
      onChange(String($select.val() ?? ''));
    };

    $select.on('change.select2-react', handleSelectChange);

    return () => {
      $select.off('change.select2-react', handleSelectChange);
      if ($select.hasClass('select2-hidden-accessible')) {
        $select.select2('destroy');
      }
    };
  }, [onChange, options, placeholder, searchMinResults, value]);

  return (
    <select
      ref={selectRef}
      className={`w-full ${className}`.trim()}
      value={value}
      onChange={event => onChange(event.target.value)}
      disabled={disabled}
    >
      <option value="">{placeholder}</option>
      {options.map(option => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
