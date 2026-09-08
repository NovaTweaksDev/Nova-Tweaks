import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { joinClasses } from './classNames';
import { useAppPortalContainer } from './useAppPortalContainer';

function Select({ value, onChange, options = [], disabled = false, ariaLabel = '', className = '' }) {
  const portalContainer = useAppPortalContainer();
  const selectedOption = options.find((option) => String(option.value) === String(value ?? ''));
  const SelectedIcon = selectedOption?.icon;
  const selectedSymbol = selectedOption?.symbol;

  return (
    <SelectPrimitive.Root value={String(value ?? '')} onValueChange={onChange} disabled={disabled}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={joinClasses(
          'nova-dropdown-trigger group flex h-10 w-full min-w-0 items-center gap-2 border px-3 text-left text-sm font-semibold text-[var(--text-primary)] outline-none disabled:cursor-not-allowed disabled:opacity-55',
          className
        )}
      >
        {SelectedIcon ? (
          <SelectedIcon
            className={joinClasses('h-4 w-4 shrink-0 text-[var(--accent)]', selectedOption?.iconClassName)}
            aria-hidden="true"
          />
        ) : null}
        {!SelectedIcon && selectedSymbol ? (
          <span className="inline-flex h-4 w-5 shrink-0 items-center justify-center text-[15px] leading-none" aria-hidden="true">
            {selectedSymbol}
          </span>
        ) : null}
        <SelectPrimitive.Value>{selectedOption?.label}</SelectPrimitive.Value>
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal container={portalContainer || undefined}>
        <SelectPrimitive.Content
          position="popper"
          align="start"
          sideOffset={7}
          collisionPadding={12}
          className="nova-dropdown-content z-[320] min-w-[var(--radix-select-trigger-width)]"
        >
          <SelectPrimitive.Viewport className="space-y-1">
            {options.map((option) => {
              const OptionIcon = option.icon;
              return (
                <SelectPrimitive.Item
                  key={option.value}
                  value={String(option.value)}
                  disabled={Boolean(option.disabled)}
                  className="nova-dropdown-item group/item relative flex cursor-default select-none items-center gap-2 px-2.5 py-2 pr-8 text-sm font-medium text-[var(--text-secondary)] data-[disabled]:pointer-events-none data-[disabled]:opacity-45"
                >
                  {OptionIcon ? (
                    <OptionIcon
                      className={joinClasses('h-4 w-4 shrink-0 text-[var(--text-muted)] group-data-[state=checked]/item:text-[var(--accent)]', option.iconClassName)}
                      aria-hidden="true"
                    />
                  ) : null}
                  {!OptionIcon && option.symbol ? (
                    <span className="inline-flex h-4 w-5 shrink-0 items-center justify-center text-[15px] leading-none" aria-hidden="true">
                      {option.symbol}
                    </span>
                  ) : null}
                  <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className="absolute right-2.5 inline-flex text-[var(--accent)]">
                    <Check className="h-4 w-4" aria-hidden="true" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              );
            })}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export default Select;
