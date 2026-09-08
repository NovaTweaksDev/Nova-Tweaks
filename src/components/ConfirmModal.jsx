import { useTranslation } from 'react-i18next';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { Button } from './ui';

function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  loading = false,
  confirmDisabled = false,
  children = null,
  onCancel,
  onConfirm
}) {
  const { t } = useTranslation();

  if (!open) {
    return null;
  }

  return (
    <AlertDialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onCancel?.();
        }
      }}
    >
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay asChild>
          <div className="ui-modal-overlay z-[180]">
            <AlertDialogPrimitive.Content
              className="ui-modal-shell ui-modal-md"
              onEscapeKeyDown={(event) => {
                if (loading) {
                  event.preventDefault();
                }
              }}
            >
              <header className="ui-modal-header">
                <div className="min-w-0">
                  <AlertDialogPrimitive.Title asChild>
                    <h3 className="ui-panel-title text-base">{title}</h3>
                  </AlertDialogPrimitive.Title>
                </div>
              </header>

              <AlertDialogPrimitive.Description asChild>
                <p className="ui-modal-content whitespace-pre-line text-sm text-[var(--text-muted)]">{message}</p>
              </AlertDialogPrimitive.Description>
              {children}

              <footer className="ui-modal-footer">
                <AlertDialogPrimitive.Cancel asChild>
                  <Button variant="secondary" size="sm" disabled={loading}>
                    {cancelLabel || t('common.cancel')}
                  </Button>
                </AlertDialogPrimitive.Cancel>
                <Button
                  variant={tone === 'danger' ? 'danger' : 'primary'}
                  size="sm"
                  onClick={onConfirm}
                  loading={loading}
                  disabled={loading || confirmDisabled}
                >
                  {loading ? t('common.loading') : confirmLabel}
                </Button>
              </footer>
            </AlertDialogPrimitive.Content>
          </div>
        </AlertDialogPrimitive.Overlay>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}

export default ConfirmModal;
