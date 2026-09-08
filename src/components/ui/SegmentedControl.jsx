import { joinClasses } from './classNames';

function SegmentedControl({
  options = [],
  value,
  onChange,
  ariaLabel = '',
  className = '',
  itemClassName = '',
  role = 'tablist',
  itemRole = 'tab'
}) {
  function handleRadioKeyDown(event, index) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    let nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : index;
    for (let attempts = 0; attempts < options.length; attempts += 1) {
      if (event.key !== 'Home' && event.key !== 'End') {
        nextIndex = (nextIndex + direction + options.length) % options.length;
      }
      if (!options[nextIndex]?.disabled) break;
      if (event.key === 'Home') nextIndex += 1;
      if (event.key === 'End') nextIndex -= 1;
    }
    const nextOption = options[nextIndex];
    if (!nextOption || nextOption.disabled) return;
    onChange?.(nextOption.id ?? nextOption.value);
    event.currentTarget.parentElement?.children[nextIndex]?.focus();
  }

  return (
    <div className={joinClasses('ui-segment', className)} role={role} aria-label={ariaLabel || undefined}>
      {options.map((option, index) => {
        const id = option?.id ?? option?.value;
        const label = option?.label ?? String(id);
        const active = id === value;
        const disabled = Boolean(option?.disabled);
        const itemProps =
          itemRole === 'tab'
            ? {
                role: 'tab',
                'aria-selected': active ? 'true' : 'false',
                tabIndex: active ? 0 : -1
              }
            : itemRole === 'radio'
              ? {
                  role: 'radio',
                  'aria-checked': active ? 'true' : 'false',
                  tabIndex: active ? 0 : -1
                }
              : {
                  role: itemRole,
                  'aria-pressed': active ? 'true' : 'false'
                };

        return (
          <button
            key={String(id)}
            type="button"
            onClick={() => onChange?.(id)}
            onKeyDown={itemRole === 'radio' ? (event) => handleRadioKeyDown(event, index) : undefined}
            disabled={disabled}
            className={joinClasses('ui-segment-item', active ? 'is-active' : '', itemClassName)}
            {...itemProps}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default SegmentedControl;
