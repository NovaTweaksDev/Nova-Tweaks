import { useEffect, useRef, useState } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Info } from 'lucide-react';
import { useAppPortalContainer } from './ui/useAppPortalContainer';

function GameModePresetInfo({ t, definitions }) {
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const closeTimer = useRef(null);
  const portalContainer = useAppPortalContainer();

  function cancelClose() {
    clearTimeout(closeTimer.current);
  }

  function scheduleClose() {
    cancelClose();
    if (!pinned.current) closeTimer.current = setTimeout(() => setOpen(false), 140);
  }

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={(nextOpen) => {
      cancelClose();
      pinned.current = nextOpen;
      setOpen(nextOpen);
    }}>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          className="game-mode-preset-info-trigger"
          aria-label={t('gameMode.preset.info.title')}
          onPointerEnter={(event) => {
            if (event.pointerType !== 'mouse') return;
            cancelClose();
            setOpen(true);
          }}
          onPointerLeave={scheduleClose}
          onClick={(event) => {
            event.preventDefault();
            cancelClose();
            const nextOpen = !pinned.current;
            pinned.current = nextOpen;
            setOpen(nextOpen);
          }}
        >
          <Info size={14} aria-hidden="true" />
          <span>{t('gameMode.preset.info.badge')}</span>
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal container={portalContainer}>
        <PopoverPrimitive.Content
          className="game-mode-preset-info-content"
          align="end"
          side="bottom"
          sideOffset={8}
          collisionPadding={16}
          aria-label={t('gameMode.preset.info.title')}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => {
            if (!pinned.current) event.preventDefault();
          }}
          onPointerEnter={cancelClose}
          onPointerLeave={scheduleClose}
        >
          <h3>{t('gameMode.preset.info.title')}</h3>
          <ul>
            {definitions.map(({ id }) => (
              <li key={id}>
                <strong>{t(`gameMode.preset.info.items.${id}.title`)}</strong>
                <p>{t(`gameMode.preset.info.items.${id}.description`)}</p>
              </li>
            ))}
            {['background_services', 'background_apps'].map((id) => (
              <li key={id}>
                <strong>{t(`gameMode.preset.info.items.${id}.title`)}</strong>
                <p>{t(`gameMode.preset.info.items.${id}.description`)}</p>
              </li>
            ))}
          </ul>
          <p className="game-mode-preset-info-note">{t('gameMode.preset.info.restore')}</p>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

export default GameModePresetInfo;
