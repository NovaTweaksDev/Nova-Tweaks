import { Copy, ExternalLink, Mail, MessageCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui';

const DISCORD_URL = 'https://discord.gg/AkH2jJsF3M';
const SUPPORT_EMAIL = 'support@nova-tweaks.com';

function ContactSupportCard({ onOpenDiscord, onOpenEmail, onCopy }) {
  const { t } = useTranslation();

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface)_88%,var(--surface-elevated)_12%)] p-4 shadow-[var(--card-shadow-panel)]">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[color:color-mix(in_srgb,var(--accent)_22%,var(--border))] bg-[color:color-mix(in_srgb,var(--accent)_10%,var(--surface)_90%)] text-[var(--accent)]">
          <MessageCircle className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">{t('settingsPanel.support.title')}</h2>
          <p className="mt-1 text-sm leading-5 text-[var(--text-muted)]">
            {t('settingsPanel.support.description')}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                <MessageCircle className="h-4 w-4 text-[var(--accent)]" />
                {t('settingsPanel.support.discord')}
              </p>
              <p className="mt-1 truncate text-xs text-[var(--text-muted)]" title={DISCORD_URL}>{DISCORD_URL}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => onCopy?.(DISCORD_URL, t('settingsPanel.support.discord'))} leftIcon={<Copy className="h-3.5 w-3.5" />}>
                {t('settingsPanel.actions.copy')}
              </Button>
              <Button variant="primary" size="sm" onClick={onOpenDiscord} leftIcon={<ExternalLink className="h-3.5 w-3.5" />}>
                {t('settingsPanel.actions.open')}
              </Button>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                <Mail className="h-4 w-4 text-[var(--accent)]" />
                {t('settingsPanel.support.email')}
              </p>
              <p className="mt-1 truncate text-xs text-[var(--text-muted)]" title={SUPPORT_EMAIL}>{SUPPORT_EMAIL}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => onCopy?.(SUPPORT_EMAIL, t('settingsPanel.support.email'))} leftIcon={<Copy className="h-3.5 w-3.5" />}>
                {t('settingsPanel.actions.copy')}
              </Button>
              <Button variant="primary" size="sm" onClick={onOpenEmail} leftIcon={<ExternalLink className="h-3.5 w-3.5" />}>
                {t('settingsPanel.actions.open')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export { DISCORD_URL, SUPPORT_EMAIL };
export default ContactSupportCard;
