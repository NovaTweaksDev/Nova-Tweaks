import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor, MonitorCheck, RotateCcw, Save, RefreshCw, Trash2 } from 'lucide-react';
import { Button, ModalShell, SegmentedControl, StatusPill, Switch } from './ui';
import './DisplayProfilesPanel.css';

function refreshLabel(snapshot, locale) {
  const hz = snapshot?.refresh?.numerator / snapshot?.refresh?.denominator;
  return Number.isFinite(hz) ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(hz)} Hz` : '—';
}
function ProfileCard({ profile, state, pending, run, gamePath, t, locale, onRecapture, onDelete }) {
  const [name, setName] = useState(profile.name);
  useEffect(() => setName(profile.name), [profile.name]);
  const snapshot = profile.snapshot;
  const active = state.transaction?.profileId === profile.id;
  const tested = profile.tested?.revision === profile.revision;
  const available = state.displays.find((display) => display.id === snapshot.id);
  const validHardware = available?.fingerprint === snapshot.fingerprint;
  const unsupportedScaling = [5, 6].includes(snapshot.scaling) || [5, 6].includes(available?.scaling);
  const Icon = profile.kind === 'desktop' ? Monitor : MonitorCheck;
  return (
    <section className={`display-profile-card ${active ? 'is-active' : ''}`}>
      <header className="display-profile-card__header">
        <span className="display-profile-icon"><Icon size={22} aria-hidden="true" /></span>
        <div><p className="display-profile-eyebrow">{t(`displayProfiles.${profile.kind}`)}</p><h3>{profile.name}</h3></div>
        {active && <StatusPill tone="success">{t('displayProfiles.active')}</StatusPill>}
        <Button variant="ghost" size="sm" className="display-profile-delete" aria-label={t('displayProfiles.deleteNamed', { name: profile.name })} title={t('displayProfiles.delete')} disabled={pending || (active && state.transaction.status === 'confirming')} onClick={() => onDelete(profile)}><Trash2 size={17} aria-hidden="true" /></Button>
      </header>
      <div className="display-profile-resolution">{snapshot.width} <span>×</span> {snapshot.height}</div>
      <p className="display-profile-refresh">{refreshLabel(snapshot, locale)} <span>· {snapshot.name}</span></p>
      <dl className="display-profile-values">
        <div><dt>{t('displayProfiles.scaling')}</dt><dd>{t(`displayProfiles.scalingValues.${snapshot.scaling}`, { defaultValue: t('displayProfiles.unsupported') })}</dd></div>
        <div><dt>{t('displayProfiles.signal')}</dt><dd>{snapshot.signal.width} × {snapshot.signal.height} · {refreshLabel({ refresh: snapshot.signal }, locale)}</dd></div>
        <div><dt>{t('displayProfiles.vibrance')}</dt><dd>{snapshot.vibrance !== null ? `${snapshot.vibrance}%` : t('displayProfiles.keepExisting')}</dd></div>
      </dl>
      {!available && <p className="display-profile-note">{t('displayProfiles.monitorMissing')}</p>}
      {available && !validHardware && <p className="display-profile-note">{t('displayProfiles.hardwareChanged')}</p>}
      {unsupportedScaling && <p className="display-profile-note">{t('displayProfiles.aspectRatioHint')}</p>}
      <Button variant="primary" disabled={pending || !validHardware || unsupportedScaling || Boolean(state.transaction && state.transaction.status !== 'active')} onClick={() => run('activateDisplayProfile', { id: profile.id })}>
        {profile.kind === 'desktop' ? t('displayProfiles.activateDesktop') : t('displayProfiles.activateGaming')}
      </Button>
      <details className="display-profile-details">
        <summary>{t('displayProfiles.manage')}</summary>
        <label className="display-profile-field">{t('displayProfiles.profileName')}<input value={name} maxLength={80} disabled={pending} onChange={(event) => setName(event.target.value)} /></label>
        <div className="display-profile-actions">
          <Button variant="secondary" size="sm" disabled={pending || !name.trim() || name.trim() === profile.name} onClick={() => run('configureDisplayProfile', { id: profile.id, name })}>{t('displayProfiles.rename')}</Button>
          <Button variant="secondary" size="sm" disabled={pending || active || Boolean(state.transaction && state.transaction.status !== 'active')} onClick={() => onRecapture(profile)}>{t('displayProfiles.recapture')}</Button>
        </div>
        {profile.kind === 'gaming' && <>
          <p className="display-profile-note display-profile-path">{profile.executablePath || t('displayProfiles.noGame')}</p>
          <Button variant="secondary" size="sm" disabled={pending || !gamePath} onClick={() => run('configureDisplayProfile', { id: profile.id, executablePath: gamePath })}>{t('displayProfiles.bindGame')}</Button>
          <div className="display-profile-switch-row"><div><strong>{t('displayProfiles.auto')}</strong><p>{tested ? t('displayProfiles.autoHint') : t('displayProfiles.testRequired')}</p></div>
            <Switch checked={profile.auto} ariaLabel={t('displayProfiles.auto')} disabled={pending || (!profile.auto && (!tested || !profile.executablePath || !validHardware || unsupportedScaling))} onChange={(auto) => run('configureDisplayProfile', { id: profile.id, auto })} />
          </div>
        </>}
      </details>
    </section>
  );
}
export default function DisplayProfilesPanel({ visible, gamePath = '', onChooseExecutable }) {
  const { t, i18n } = useTranslation();
  const [state, setState] = useState({ profiles: [], displays: [], transaction: null });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [form, setForm] = useState({ name: '', kind: 'gaming', monitorId: '' });
  const [seconds, setSeconds] = useState(15);
  const [forceRestore, setForceRestore] = useState(false);
  const [deleteProfile, setDeleteProfile] = useState(null);
  const api = window.desktopApi;
  async function run(method, payload) {
    setPending(true); setError(null);
    try {
      if (!api?.[method]) throw new Error(t('displayProfiles.unavailable'));
      const result = await api[method](payload);
      if (result.state) setState(result.state);
      if (!result.ok) { setError({ code: result.code, message: result.message }); return false; }
      return result.state || true;
    } catch (caught) { setError({ message: caught.message }); return false; }
    finally { setPending(false); }
  }
  useEffect(() => {
    let mounted = true;
    api?.getDisplayProfileState?.().then((result) => { if (mounted && result.state) setState(result.state); }).catch(() => {});
    const unsubscribe = api?.onDisplayProfileUpdate?.((next) => { if (mounted) setState(next); });
    return () => { mounted = false; unsubscribe?.(); };
  }, [api]);
  useEffect(() => { if (visible) void run('refreshDisplayProfiles'); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const transaction = state.transaction;
  const confirming = transaction?.status === 'confirming';
  useEffect(() => {
    if (!confirming) return;
    const update = () => setSeconds(Math.max(0, Math.ceil((transaction.deadline - Date.now()) / 1000)));
    update(); const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [confirming, transaction?.deadline]);
  const locked = pending || state.busy;
  const monitor = state.displays.find((entry) => entry.id === form.monitorId);
  const currentError = error || state.lastError;
  async function openCapture(profile) {
    const fresh = await run('refreshDisplayProfiles');
    if (!fresh) return;
    setForm({ id: profile?.id, name: profile?.name || '', kind: profile?.kind || 'gaming', monitorId: profile?.snapshot.id || fresh.displays?.[0]?.id || '' });
    setCaptureOpen(true);
  }
  return <>
    <div hidden={!visible} className="display-profiles-panel">
      <section className="display-profiles-intro game-mode-card">
        <div className="game-mode-control-center__identity">
          <span className="game-mode-game-icon game-mode-game-icon--hero" aria-hidden="true">
            <Monitor strokeWidth={1.8} />
          </span>
          <div className="min-w-0"><h2>{t('displayProfiles.title')}</h2><p>{t('displayProfiles.description')}</p></div>
        </div>
        <div className="display-profile-actions">
          <Button variant="secondary" leftIcon={<RefreshCw size={16} />} disabled={locked} onClick={() => run('refreshDisplayProfiles')}>{t('displayProfiles.refresh')}</Button>
          <Button variant="primary" leftIcon={<Save size={16} />} disabled={locked || Boolean(transaction && transaction.status !== 'active') || !state.displays.length || Boolean(state.warning)} onClick={() => openCapture()}>{t('displayProfiles.capture')}</Button>
        </div>
      </section>
      {currentError && <div className="game-mode-alert game-mode-alert--danger" role="alert"><strong>{t(`displayProfiles.errors.${currentError.code}`, { defaultValue: t('displayProfiles.operationFailed') })}</strong><p>{currentError.code === 'DISPLAY_SCALING_UNVERIFIED' ? t('displayProfiles.aspectRatioHint') : currentError.message}</p></div>}
      {state.warning && <p className="game-mode-alert game-mode-alert--danger" role="alert">{t('displayProfiles.storageInvalid')}</p>}
      {transaction && <section className="display-profile-session" aria-live="polite">
        <div><strong>{t(transaction.status === 'active' ? 'displayProfiles.sessionActive' : 'displayProfiles.recoveryPending')}</strong><p>{t('displayProfiles.returnHint')}</p></div>
        <div className="display-profile-actions">
          <Button variant="secondary" leftIcon={<RotateCcw size={16} />} disabled={locked || confirming} onClick={() => run('restoreDisplayProfile')}>{t('displayProfiles.restorePrevious')}</Button>
          {['conflict', 'recovery'].includes(transaction.status) && <>
            <Button variant="secondary" disabled={locked} onClick={() => setForceRestore(true)}>{t('displayProfiles.restoreExplicit')}</Button>
          </>}
          {!confirming && <Button variant="ghost" disabled={locked} onClick={() => run('keepCurrentDisplayState')}>{t('displayProfiles.keepCurrent')}</Button>}
        </div>
      </section>}
      {!state.profiles.length && <section className="display-profiles-empty"><Monitor size={32} aria-hidden="true" /><h3>{t('displayProfiles.emptyTitle')}</h3><p>{t('displayProfiles.emptyDescription')}</p></section>}
      <div className="display-profiles-grid">{[...state.profiles].sort((a, b) => Number(b.kind === 'desktop') - Number(a.kind === 'desktop')).map((profile) =>
        <ProfileCard key={profile.id} profile={profile} state={state} pending={locked} run={run} gamePath={gamePath} t={t} locale={i18n.language} onRecapture={openCapture} onDelete={setDeleteProfile} />)}</div>
      <section className="display-profile-footer"><Button variant="ghost" size="sm" disabled={locked} title={t('displayProfiles.gameSelectionHint')} onClick={onChooseExecutable}>{t('displayProfiles.chooseGame')}</Button><span className="display-profile-path">{gamePath}</span></section>
    </div>
    <ModalShell open={captureOpen} closeLabel={t('common.close')} onClose={() => { if (!locked) setCaptureOpen(false); }} title={t('displayProfiles.captureTitle')} description={t('displayProfiles.captureHint')}>
      <form className="display-profile-form" onSubmit={async (event) => { event.preventDefault(); if (await run('captureDisplayProfile', form)) setCaptureOpen(false); }}>
        <SegmentedControl value={form.kind} onChange={(kind) => setForm({ ...form, kind })} ariaLabel={t('displayProfiles.profileType')} role="radiogroup" itemRole="radio" options={[
          { id: 'desktop', label: t('displayProfiles.desktop'), disabled: Boolean(form.id && form.kind !== 'desktop') || Boolean(transaction && state.profiles.some((profile) => profile.kind === 'desktop' && profile.id === transaction.profileId)) },
          { id: 'gaming', label: t('displayProfiles.gaming'), disabled: Boolean(form.id && form.kind !== 'gaming') }
        ]} />
        <label className="display-profile-field">{t('displayProfiles.profileName')}<input value={form.name} required maxLength={80} disabled={locked} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label className="display-profile-field">{t('displayProfiles.monitor')}<select value={form.monitorId} disabled={locked} onChange={(event) => setForm({ ...form, monitorId: event.target.value })}>
          {state.displays.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.width} × {entry.height} · {refreshLabel(entry, i18n.language)}</option>)}
        </select></label>
        <details className="display-profile-details" open>
          <summary>{t('displayProfiles.savedSettings')}</summary>
          <div className="display-profile-switch-row"><div><strong>{t('displayProfiles.scaling')}</strong><p>{t(`displayProfiles.scalingValues.${monitor?.scaling}`, { defaultValue: t('displayProfiles.unsupported') })}</p></div></div>
          {[5, 6].includes(monitor?.scaling) && <p className="display-profile-note" role="status">{t('displayProfiles.aspectRatioHint')}</p>}
          <div className="display-profile-switch-row"><div><strong>{t('displayProfiles.vibrance')}</strong><p>{monitor?.capabilities.vibrance ? `${monitor.vibrance}%` : t('displayProfiles.unsupported')}</p></div></div>
        </details>
        {form.kind === 'desktop' && state.profiles.some((entry) => entry.kind === 'desktop') && <p className="display-profile-note">{t('displayProfiles.replaceDesktop')}</p>}
        <Button type="submit" variant="primary" disabled={locked || !form.name.trim() || !monitor}>{t('displayProfiles.save')}</Button>
      </form>
    </ModalShell>
    <ModalShell open={Boolean(deleteProfile)} closeLabel={t('common.close')} onClose={() => { if (!locked) setDeleteProfile(null); }} title={t('displayProfiles.deleteNamed', { name: deleteProfile?.name })} description={t(transaction?.profileId === deleteProfile?.id ? 'displayProfiles.deleteActiveHint' : 'displayProfiles.deleteHint')}>
      <div className="display-profile-actions"><Button variant="secondary" disabled={locked} onClick={() => setDeleteProfile(null)}>{t('displayProfiles.cancel')}</Button><Button variant="danger" disabled={locked} leftIcon={<Trash2 size={16} />} onClick={async () => { if (await run('deleteDisplayProfile', { id: deleteProfile.id })) setDeleteProfile(null); }}>{t('displayProfiles.delete')}</Button></div>
    </ModalShell>
    <ModalShell open={confirming} closeLabel={t('common.close')} onClose={() => { if (!locked) void run('restoreDisplayProfile', { force: true }); }} title={t('displayProfiles.confirmTitle')} description={t('displayProfiles.confirmHint', { seconds })}>
      <div className="display-profile-actions"><Button variant="primary" disabled={locked || seconds <= 0} onClick={() => run('confirmDisplayProfile', { id: transaction.id })}>{t('displayProfiles.confirm')}</Button><Button variant="secondary" disabled={locked} onClick={() => run('restoreDisplayProfile', { force: true })}>{t('displayProfiles.revert')}</Button></div>
    </ModalShell>
    <ModalShell open={forceRestore} closeLabel={t('common.close')} onClose={() => setForceRestore(false)} title={t('displayProfiles.restoreExplicit')} description={t('displayProfiles.forceHint')}>
      <Button variant="primary" disabled={locked} onClick={async () => { if (await run('restoreDisplayProfile', { force: true })) setForceRestore(false); }}>{t('displayProfiles.restorePrevious')}</Button>
    </ModalShell>
  </>;
}
