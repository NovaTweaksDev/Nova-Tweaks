import { ArrowDown, ArrowUp, ArrowUpDown, Check, SlidersHorizontal, TrendingUp, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PremiumBadge } from './ui';
import CategoryIcon from './CategoryIcon';
import SubcategoryIcon from './SubcategoryIcon';
import {
  getLocalizedTweakDescription,
  getImpactValue,
  getTweakStatusLabel,
  normalizePremium,
  normalizeRecommended,
  normalizeRiskLevel
} from '../utils/tweakMetadata';
import { getCategoryAccentStyle } from '../constants/categoryAccents';

function DetailRow({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <span className="text-sm font-semibold leading-5 text-[var(--text-secondary)]">{label}</span>
      <span className="min-w-0 text-right text-sm font-semibold leading-5 text-[var(--text-primary)]">{children}</span>
    </div>
  );
}

function MutedValue({ children }) {
  return <span className="text-[var(--text-muted)]">{children}</span>;
}

function InlineValueIcon({ icon: Icon, className = 'text-[var(--accent)]' }) {
  return <Icon className={`h-3.5 w-3.5 shrink-0 ${className}`} aria-hidden="true" />;
}

function RiskIcon({ riskLevel }) {
  if (riskLevel === 'high') {
    return <InlineValueIcon icon={ArrowUp} className="text-[var(--danger)]" />;
  }

  if (riskLevel === 'medium') {
    return <InlineValueIcon icon={ArrowUpDown} className="text-[var(--warning)]" />;
  }

  return <InlineValueIcon icon={ArrowDown} className="text-[var(--success)]" />;
}

function ImpactDots({ value }) {
  const safeValue = Math.max(0, Math.min(5, Math.trunc(Number(value) || 0)));
  return (
    <span className="inline-flex items-center gap-1.5">
      {Array.from({ length: 5 }, (_, index) => (
        <span
          key={index}
          className={`h-2 w-2 rounded-full ${index < safeValue ? 'bg-[var(--accent)]' : 'bg-[color:color-mix(in_srgb,var(--text-muted)_24%,transparent)]'}`}
        />
      ))}
    </span>
  );
}

function localizeStatus(label, t) {
  const normalized = String(label || '').toLowerCase();
  if (normalized === 'enabled') return t('tweaks.state.enabled');
  if (normalized === 'disabled') return t('tweaks.state.disabled');
  if (normalized === 'pending') return t('tweaks.state.pending');
  if (normalized === 'ready') return t('tweaks.oneShotAction.ready');
  if (normalized === 'reboot required' || normalized === 'restart required') return t('tweaks.rebootRequired', { defaultValue: 'Reboot required' });
  return label || t('tweakDetails.unknown');
}

function localizeCategory(category, t) {
  const safeCategory = category || 'General';
  return t(`tweaks.categories.${safeCategory}`, { defaultValue: safeCategory });
}

function TweakDetailPanel({ tweak, onClose, showRiskLabels = true, showCategoryAccent = false, blurName = false }) {
  const { i18n, t } = useTranslation();

  if (!tweak) {
    return (
      <aside className="ui-right-panel tweak-detail-panel hidden h-fit lg:block">
        <div className="tech-panel-header">
          <p className="tech-panel-title text-[17px] font-semibold leading-6 text-[var(--text-primary)]">{t('tweakDetails.title')}</p>
        </div>
        <section className="tweak-detail-empty">
          <span className="tweak-detail-empty-icon" aria-hidden="true">
            <SlidersHorizontal className="h-5 w-5" />
          </span>
          <p className="tweak-detail-empty-title">{t('tweakDetails.empty')}</p>
          <p className="tweak-detail-empty-description">{t('tweakDetails.emptyDescription')}</p>
        </section>
      </aside>
    );
  }

  const description = getLocalizedTweakDescription(tweak, i18n.language) || t('tweakDetails.noDescription');

  const recommended = normalizeRecommended(tweak);
  const premium = normalizePremium(tweak);
  const statusLabel = getTweakStatusLabel(tweak);
  const normalizedStatusLabel = statusLabel.toLowerCase();
  const statusEnabled = normalizedStatusLabel === 'enabled';
  const riskLevel = normalizeRiskLevel(tweak);
  const riskLabel = t(`tweakDetails.risk.${riskLevel}`, { defaultValue: riskLevel });
  const accentStyle = showCategoryAccent ? getCategoryAccentStyle(tweak.category) : undefined;
  const iconClass = showCategoryAccent
    ? 'border-[color:color-mix(in_srgb,var(--category-accent)_28%,var(--border))] bg-[var(--surface)] text-[var(--category-accent)]'
    : 'border-[var(--border-subtle)] bg-[var(--surface)] text-[var(--text-muted)]';
  const categoryValueClass = showCategoryAccent ? 'text-[var(--category-accent)]' : 'text-[var(--text-muted)]';

  return (
    <aside style={accentStyle} className="ui-right-panel tweak-detail-panel h-fit">
      <div className="tech-panel-header">
        <h3 className="tech-panel-title text-[17px] font-semibold leading-6 text-[var(--text-primary)]">{t('tweakDetails.title')}</h3>
        <button
          type="button"
          onClick={onClose}
          className="tweak-detail-close"
          aria-label={t('tweakDetails.close')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <section className="tweak-detail-summary">
        <div className="tweak-detail-name-row">
          <span className={`tweak-detail-icon border ${iconClass}`}>
            <SubcategoryIcon category={tweak.category} subcategory={tweak.subcategory} className="h-5 w-5" />
          </span>
          <h4 className="tweak-detail-name">
            <span className={blurName ? 'premium-name-blur' : undefined}>{tweak.name}</span>
          </h4>
        </div>
        <div className="tweak-detail-divider" />
        <p className="tweak-detail-description">{description}</p>
      </section>

      <section className="tweak-detail-metadata">
        <div className="divide-y divide-[var(--border-subtle)]">
          <DetailRow label={t('tweakDetails.category')}>
            <span className={`inline-flex items-center justify-end gap-1.5 ${categoryValueClass}`}>
              <CategoryIcon category={tweak.category} className="h-3.5 w-3.5 shrink-0" />
              {localizeCategory(tweak.category, t)}
            </span>
          </DetailRow>
          <DetailRow label={t('tweakDetails.status')}>
            <span className={`inline-flex items-center justify-end gap-1.5 ${statusEnabled ? 'text-[var(--success)]' : normalizedStatusLabel === 'ready' ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
              {statusEnabled ? <InlineValueIcon icon={Check} className="text-[var(--success)]" /> : normalizedStatusLabel === 'ready' ? <InlineValueIcon icon={TrendingUp} /> : normalizedStatusLabel === 'disabled' ? <InlineValueIcon icon={X} className="text-[var(--text-muted)]" /> : null}
              {localizeStatus(statusLabel, t)}
            </span>
          </DetailRow>
          <DetailRow label={t('tweakDetails.impact')}><ImpactDots value={getImpactValue(tweak)} /></DetailRow>
          {showRiskLabels ? (
            <DetailRow label={t('tweakDetails.riskLabel')}>
              <span className={`inline-flex items-center justify-end gap-1.5 ${
                riskLevel === 'high'
                  ? 'text-[var(--danger)]'
                  : riskLevel === 'medium'
                    ? 'text-[var(--warning)]'
                    : 'text-[var(--success)]'
              }`}>
                <RiskIcon riskLevel={riskLevel} />
                {riskLabel}
              </span>
            </DetailRow>
          ) : null}
          <DetailRow label={t('tweakDetails.recommended')}>
            {recommended ? (
              <span className="inline-flex items-center justify-end gap-1.5 text-[var(--accent)]">
                <InlineValueIcon icon={Check} />
                {t('tweakDetails.yes')}
              </span>
            ) : <MutedValue>{t('tweakDetails.no')}</MutedValue>}
          </DetailRow>
          <DetailRow label={t('tweaks.premiumBadge')}>{premium ? <PremiumBadge label={t('tweaks.premiumBadge')} /> : <MutedValue>{t('tweakDetails.no')}</MutedValue>}</DetailRow>
        </div>
      </section>
    </aside>
  );
}

export default TweakDetailPanel;
