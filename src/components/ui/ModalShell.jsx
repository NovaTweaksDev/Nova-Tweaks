import { useId, useRef } from 'react';
import { X } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { joinClasses } from './classNames';

const MODAL_SIZE_CLASS = {
  sm: 'ui-modal-sm',
  md: 'ui-modal-md',
  lg: 'ui-modal-lg',
  xl: 'ui-modal-xl'
};

function ModalShell({
  open,
  title,
  description = '',
  children,
  footer = null,
  onClose,
  closeLabel = 'Close',
  closeDisabled = false,
  showCloseButton = true,
  closeOnBackdrop = true,
  closeOnEscape = true,
  size = 'md',
  overlayClassName = '',
  className = '',
  contentClassName = ''
}) {
  const titleId = useId();
  const restoreFocusRef = useRef(null);
  const previousOpenRef = useRef(false);

  if (open && !previousOpenRef.current) {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  previousOpenRef.current = open;

  function handleOpenChange(nextOpen) {
    if (!nextOpen) {
      const restoreFocusTarget = restoreFocusRef.current;
      onClose?.();
      window.requestAnimationFrame(() => restoreFocusTarget?.focus({ preventScroll: true }));
    }
  }

  const sizeClass = MODAL_SIZE_CLASS[size] || MODAL_SIZE_CLASS.md;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay asChild>
          <div className={joinClasses('ui-modal-overlay', overlayClassName)}>
            <DialogPrimitive.Content
              aria-labelledby={title ? titleId : undefined}
              className={joinClasses('ui-modal-shell', sizeClass, className)}
              onEscapeKeyDown={(event) => {
                if (!closeOnEscape) {
                  event.preventDefault();
                }
              }}
              onPointerDownOutside={(event) => {
                if (!closeOnBackdrop) {
                  event.preventDefault();
                }
              }}
            >
              {(title || description || showCloseButton) ? (
                <header className="ui-modal-header">
                  <div className="min-w-0">
                    {title ? (
                      <DialogPrimitive.Title asChild>
                        <h3 id={titleId} className="ui-panel-title text-base">
                          {title}
                        </h3>
                      </DialogPrimitive.Title>
                    ) : null}
                    {description ? (
                      <DialogPrimitive.Description asChild>
                        <p className="mt-1 text-xs text-[var(--text-muted)]">{description}</p>
                      </DialogPrimitive.Description>
                    ) : null}
                  </div>
                  {showCloseButton ? (
                    <DialogPrimitive.Close asChild>
                      <button
                        type="button"
                        className="ui-modal-close-button"
                        disabled={closeDisabled}
                        aria-label={closeLabel}
                        title={closeLabel}
                      >
                        <X className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
                      </button>
                    </DialogPrimitive.Close>
                  ) : null}
                </header>
              ) : null}

              <div className={joinClasses('ui-modal-content', contentClassName)}>{children}</div>

              {footer ? <footer className="ui-modal-footer">{footer}</footer> : null}
            </DialogPrimitive.Content>
          </div>
        </DialogPrimitive.Overlay>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export default ModalShell;
