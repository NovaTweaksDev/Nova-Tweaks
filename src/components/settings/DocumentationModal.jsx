import { BookOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import novaTweaksUserGuide from '../../content/novaTweaksUserGuide';
import { ModalShell } from '../ui';

function DocumentationModal({ open, onClose }) {
  const { t } = useTranslation();

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={t('settingsGuide.modalTitle')}
      description={t('settingsGuide.modalDescription')}
      size="lg"
      contentClassName="max-h-[70vh] overflow-y-auto pr-1"
    >
      <div className="space-y-4">
        {novaTweaksUserGuide.map((section) => (
          <section key={section.titleKey} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] p-4">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-[var(--accent)]" />
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t(section.titleKey)}</h3>
            </div>
            <div className="mt-2 space-y-2">
              {section.bodyKeys.map((bodyKey) => (
                <p key={bodyKey} className="text-sm leading-6 text-[var(--text-secondary)]">
                  {t(bodyKey)}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </ModalShell>
  );
}

export default DocumentationModal;
