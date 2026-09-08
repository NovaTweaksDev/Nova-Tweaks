import i18n from '../i18n';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Boxes,
  Coffee,
  Activity,
  DatabaseBackup,
  Gauge,
  Gamepad2,
  Heart,
  LayoutDashboard,
  LockKeyhole,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRoundCheck,
  Workflow
} from 'lucide-react';

const SIDEBAR_LOGO_SRC = new URL('../../resources/pictures/logo/logo.ico', import.meta.url).href;
const FEATURE_NAV_IDS = new Set(['session-monitoring', 'game-mode', 'ai']);
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const SUPPORT_HEART_COLORS = ['#d8a4dc', '#c7a6ea', '#e5a7cf', '#b9a5ed'];

let nextSupportHeartParticleId = 0;

function getInitialReducedMotionPreference() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function createSupportHeartParticles() {
  const particleCount = 4 + Math.floor(Math.random() * 3);

  return Array.from({ length: particleCount }, (_, index) => ({
    id: nextSupportHeartParticleId++,
    color: SUPPORT_HEART_COLORS[index % SUPPORT_HEART_COLORS.length],
    delay: `${Math.round(Math.random() * 100)}ms`,
    drift: `${Math.round(-18 + Math.random() * 36)}px`,
    duration: `${Math.round(1500 + Math.random() * 500)}ms`,
    rise: `${Math.round(40 + Math.random() * 18)}px`,
    rotation: `${Math.round(-18 + Math.random() * 36)}deg`,
    size: `${Math.round(8 + Math.random() * 5)}px`
  }));
}

const itemIcons = {
  dashboard: LayoutDashboard,
  tweaks: SlidersHorizontal,
  ai: Sparkles,
  apps: Boxes,
  'session-monitoring': Activity,
  'game-mode': Gamepad2,
  backup: DatabaseBackup,
  overview: Gauge,
  automation: Workflow,
  settings: Settings
};

function SidebarItem({ item, active, feature, locked = false, onSelect, onPrefetch, premiumLabel }) {
  const ItemIcon = itemIcons[item.id];
  const featureMeta = FEATURE_NAV_IDS.has(item.id)
    ? { detail: item.subtitle }
    : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      onPointerEnter={() => onPrefetch?.(item.id)}
      onPointerDown={() => onPrefetch?.(item.id)}
      onFocus={() => onPrefetch?.(item.id)}
      title={item.label}
      aria-label={locked ? `${item.label} — ${premiumLabel}` : item.label}
      className={`app-sidebar-nav-button app-region-no-drag group relative w-full overflow-hidden rounded-xl border text-left transition duration-200 ${
        active ? 'is-active' : ''
      } ${feature ? 'app-sidebar-feature-button' : ''}`}
    >
      <span className="app-sidebar-nav-inner">
        <span className="app-sidebar-icon-shell" aria-hidden="true">
          {ItemIcon ? <ItemIcon className="h-[18px] w-[18px]" strokeWidth={1.85} /> : null}
        </span>

        <span className="app-sidebar-nav-text">
          <span className={`app-sidebar-nav-label ${feature ? 'app-sidebar-nav-label--feature' : ''}`}>
            {item.label}
          </span>
          {featureMeta ? (
            <span className="app-sidebar-feature-detail">{featureMeta.detail}</span>
          ) : null}
        </span>

        {locked ? (
          <LockKeyhole className="ml-auto h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" strokeWidth={1.85} aria-hidden="true" />
        ) : Number(item.badge) > 0 ? (
          <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-[var(--danger)] px-1.5 py-0.5 text-[10px] font-bold text-white">
            {Number(item.badge) > 9 ? '9+' : item.badge}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function SidebarNavigation({
  items,
  activeSection,
  onSelect,
  onPrefetch,
  isOpen,
  onClose,
  adminStatus,
  isAdmin,
  onRequestAdminRelaunch,
  onOpenCommandPalette,
  onSupport
}) {
  const { t } = useTranslation();
  const [elevationState, setElevationState] = useState("idle");
  const [supportHeartParticles, setSupportHeartParticles] = useState([]);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(getInitialReducedMotionPreference);
  const runtimeStateKnown = typeof isAdmin === 'boolean';
  const runtimeAccessActive = isAdmin === true;
  const runtimeStatusToneClass = runtimeAccessActive ? 'text-[var(--success)]' : 'text-[var(--warning)]';
  async function requestElevation() {
    if (elevationState === 'pending' || typeof onRequestAdminRelaunch !== 'function') {
      return;
    }
    setElevationState("pending");
    const result = await onRequestAdminRelaunch();
    if (!result?.ok) {
      setElevationState('failed');
    }
  }
  const featureItems = items.filter((item) => FEATURE_NAV_IDS.has(item.id));
  const mainItems = items.filter((item) => !FEATURE_NAV_IDS.has(item.id));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined;
    }

    const mediaQuery = window.matchMedia(REDUCED_MOTION_QUERY);
    const handlePreferenceChange = (event) => {
      setPrefersReducedMotion(event.matches);
      if (event.matches) {
        setSupportHeartParticles([]);
      }
    };

    setPrefersReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener('change', handlePreferenceChange);

    return () => {
      mediaQuery.removeEventListener('change', handlePreferenceChange);
    };
  }, []);

  function handleSupportMouseEnter() {
    if (prefersReducedMotion) {
      return;
    }

    setSupportHeartParticles((currentParticles) => [
      ...currentParticles,
      ...createSupportHeartParticles()
    ]);
  }

  function removeSupportHeartParticle(particleId) {
    setSupportHeartParticles((currentParticles) => (
      currentParticles.filter((particle) => particle.id !== particleId)
    ));
  }

  return (
    <>
      {isOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={onClose}
          aria-label={t('common.close')}
        />
      ) : null}

      <aside
        className={`app-sidebar fixed bottom-0 left-0 z-40 flex w-72 flex-col border-r px-4 py-5 transition-transform duration-300 md:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="app-sidebar-header app-region-drag flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="app-sidebar-logo-shell" aria-hidden="true">
              <img src={SIDEBAR_LOGO_SRC} alt="" className="h-9 w-9 shrink-0 object-contain" />
            </span>
            <h2 className="app-sidebar-logo-title ui-panel-title text-[1.45rem] leading-[1.05]">{t('app.name')}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="app-region-no-drag rounded-[10px] border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-1 text-xs text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--text-primary)] md:hidden"
          >
            {t('common.close')}
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="app-sidebar-command-button app-region-no-drag mt-5 flex w-full items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[color:color-mix(in_srgb,var(--surface)_76%,var(--surface-strong)_24%)] px-3 py-2.5 text-left text-xs font-medium text-[var(--text-muted)] transition hover:border-[color:color-mix(in_srgb,var(--accent)_30%,var(--border))] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          aria-label={t('commandPalette.open')}
        >
          <Search className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{t('commandPalette.open')}</span>
          <kbd className="rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--text-muted)]">Ctrl K</kbd>
        </button>

        <nav className="app-sidebar-nav mt-4 flex min-h-0 flex-1 flex-col">
          <div className="app-sidebar-feature-group">
            {featureItems.map((item) => (
              <SidebarItem
                key={item.id}
                item={item}
                active={item.id === activeSection}
                feature
                onSelect={onSelect}
                onPrefetch={onPrefetch}
                premiumLabel={t('gameMode.premiumBadge')}
              />
            ))}
          </div>

          <div className="app-sidebar-nav-divider" aria-hidden="true" />

          <p className="app-sidebar-section-label">{t('nav.mainMenu', { defaultValue: 'Menu' })}</p>

          <div className="app-sidebar-main-list">
            {mainItems.map((item) => (
              <SidebarItem
                key={item.id}
                item={item}
                active={item.id === activeSection}
                onSelect={onSelect}
                onPrefetch={onPrefetch}
                premiumLabel={t('gameMode.premiumBadge')}
              />
            ))}
          </div>
        </nav>

        <div className="app-sidebar-footer mt-auto space-y-2">
          <div className="app-sidebar-status-card ui-card p-3.5">
            <div className="flex flex-col gap-2.5">
              <p className="ui-overline inline-flex items-center gap-1.5 text-[var(--text-muted)]">
                <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.85} />
                {t('status.title')}
              </p>
              <p className={`inline-flex items-center gap-2 text-[0.95rem] font-medium tracking-normal ${runtimeStateKnown ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
                <UserRoundCheck className={`h-4 w-4 shrink-0 ${runtimeStateKnown ? runtimeStatusToneClass : 'text-[var(--text-muted)]'}`} strokeWidth={1.85} />
                <span>{adminStatus}</span>
              </p>
              {runtimeStateKnown && !runtimeAccessActive ? (
                <button
                  type="button"
                  disabled={elevationState === 'pending'}
                  onClick={requestElevation}
                  className="app-region-no-drag rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-2 text-left text-xs font-semibold text-[var(--text-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:cursor-wait disabled:opacity-60"
                >
                  {elevationState === 'pending' ? t('status.elevating') : t('status.elevate')}
                </button>
              ) : null}
              {elevationState === 'failed' ? (
                <p className="text-xs leading-5 text-[var(--warning)]">{t('status.elevationFailed')}</p>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            onClick={onSupport}
            onMouseEnter={handleSupportMouseEnter}
            title={t('support.voluntary', { defaultValue: 'Entirely optional. Nova Tweaks remains fully usable without support.' })}
            aria-label={t('support.voluntaryAction', { defaultValue: 'Optional support: Buy me a coffee' })}
            className="app-sidebar-account-button ui-card app-region-no-drag flex w-full items-center gap-2.5 p-2.5 text-left transition hover:border-[color:color-mix(in_srgb,var(--accent)_28%,var(--border))] hover:bg-[var(--surface-hover)]"
          >
            <span className="app-sidebar-support-icon inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--accent)]">
              <Coffee className="h-4 w-4" strokeWidth={1.9} aria-hidden="true" />
              <span className="app-sidebar-support-particles" aria-hidden="true">
                {supportHeartParticles.map((particle) => (
                  <span
                    key={particle.id}
                    className="app-sidebar-support-heart"
                    onAnimationEnd={() => removeSupportHeartParticle(particle.id)}
                    style={{
                      '--support-heart-color': particle.color,
                      '--support-heart-delay': particle.delay,
                      '--support-heart-drift': particle.drift,
                      '--support-heart-duration': particle.duration,
                      '--support-heart-rise': particle.rise,
                      '--support-heart-rotation': particle.rotation,
                      '--support-heart-size': particle.size
                    }}
                  >
                    <Heart aria-hidden="true" />
                  </span>
                ))}
              </span>
            </span>
            <span className="app-sidebar-account-text min-w-0">
              <span className="block truncate text-[0.95rem] font-semibold tracking-normal">{t('support.title', { defaultValue: 'Support Nova Tweaks' })}</span>
              <span className="block truncate text-xs text-[var(--text-muted)]">{t('support.subtitle', { defaultValue: 'Optional · Buy me a coffee' })}</span>
            </span>
          </button>
        </div>
      </aside>
    </>
  );
}

export default SidebarNavigation;
