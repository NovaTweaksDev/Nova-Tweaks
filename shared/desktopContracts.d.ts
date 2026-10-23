export interface MonitoringSampleMetadata {
  sampleKind: 'measurement' | 'heartbeat' | 'status';
  sampleId: number | null;
  measuredAt: number | null;
  emittedAt: number;
  timestamp: number;
}

export type TweakState = 'enabled' | 'disabled';
export type TweakStateCheckStatus = 'pending' | 'verified' | 'failed' | 'unsupported';
export interface TweakStateCheck {
  id: string;
  currentState: TweakState | null;
  checked: boolean;
  stateCheckStatus: TweakStateCheckStatus;
  stateCheckError: { code: string; message?: string } | null;
}
export interface TweakStateApi {
  checkTweakState(payload: { id: string }): Promise<IpcResult<{ tweak: TweakStateCheck }>>;
}
export interface TweakRequest {
  id: string;
  targetState?: TweakState;
  params?: Record<string, string | number | boolean>;
  timeoutMs?: number;
}
export interface TweakExecution {
  type: string;
  script: string;
  timeoutMs?: number;
  actions: Partial<Record<'apply' | 'detect' | 'restore', {
    args: string[]; requiresAdmin: boolean; allowedParams: string[];
  }>>;
}
export interface RestoreRequest { id: string; scope?: string[]; }
export interface RestoreError { code: string; message: string; }
export type RestoreStatus = 'prepared' | 'running' | 'completed' | 'failed' | 'interrupted';
export interface RestoreJob {
  id: string; backupId: string; status: RestoreStatus;
  revision: number; current: number; total: number; currentTweakId: string;
  steps: { id: string; status: 'pending' | 'started' | 'completed' | 'failed'; error?: RestoreError; changed: boolean; requiresRestart: boolean }[];
  ok: boolean; partial: boolean; appliedScopes: string[];
  errorCount: number; errors: RestoreError[]; requiresRestart: boolean; adminRequired: boolean;
}
export type IpcResult<T> = ({ ok: true } & T) | ({ ok: false } & RestoreError);
export interface RestoreService {
  start(request: RestoreRequest): Promise<IpcResult<{ job: RestoreJob }>>;
  resume(id: string): Promise<IpcResult<{ job: RestoreJob }>>;
  status(id: string): Promise<RestoreJob>;
  list(): Promise<RestoreJob[]>;
}
export interface RestoreApi {
  startBackupRestore(request: RestoreRequest): Promise<IpcResult<{ job: RestoreJob }>>;
  resumeBackupRestore(request: { id: string }): Promise<IpcResult<{ job: RestoreJob }>>;
  getBackupRestoreStatus(request: { id: string }): Promise<IpcResult<{ job: RestoreJob }>>;
  listBackupRestores(): Promise<IpcResult<{ jobs: RestoreJob[] }>>;
  onBackupRestoreUpdate(callback: (job: RestoreJob) => void): () => void;
}
export interface DisplaySnapshot {
  id: string; name: string; fingerprint: string; token: string;
  width: number; height: number;
  refresh: { numerator: number; denominator: number };
  signal: { width: number; height: number; numerator: number; denominator: number };
  scaling: number; vibrance: number | null;
  capabilities: { nvidiaScaling: boolean; vibrance: boolean };
  nativeState: { pixelRate: string; totalWidth: number; totalHeight: number; windowsScaling: number; scanline: number; vibrance: number };
}
export interface DisplayProfile {
  id: string; kind: 'desktop' | 'gaming'; name: string; revision: number;
  snapshot: DisplaySnapshot; auto: boolean; executablePath: string;
  tested: { revision: number; fingerprint: string } | null;
}
export interface DisplayProfileState {
  profiles: DisplayProfile[]; displays: DisplaySnapshot[]; busy: boolean;
  warning: string | null; lastError: RestoreError | null;
  transaction: null | {
    id: string; profileId: string; original: DisplaySnapshot; applied: DisplaySnapshot;
    status: 'confirming' | 'active' | 'conflict' | 'recovery'; deadline: number | null;
    game: { pid: number; startTime: string; executablePath: string } | null;
    returnTo?: { profileId: string; snapshot: DisplaySnapshot };
  };
}
export interface DisplayProfileApi {
  getDisplayProfileState(): Promise<IpcResult<{ state: DisplayProfileState }>>;
  refreshDisplayProfiles(): Promise<IpcResult<{ state: DisplayProfileState }>>;
  captureDisplayProfile(payload: { id?: string; kind: 'desktop' | 'gaming'; name: string; monitorId: string }): Promise<IpcResult<{ state: DisplayProfileState }>>;
  configureDisplayProfile(payload: { id: string; name?: string; executablePath?: string; auto?: boolean }): Promise<IpcResult<{ state: DisplayProfileState }>>;
  deleteDisplayProfile(payload: { id: string }): Promise<IpcResult<{ state: DisplayProfileState }>>;
  validateDisplayProfile(payload: { id: string }): Promise<IpcResult<{ state: DisplayProfileState }>>;
  activateDisplayProfile(payload: { id: string }): Promise<IpcResult<{ state: DisplayProfileState }>>;
  confirmDisplayProfile(payload: { id: string }): Promise<IpcResult<{ state: DisplayProfileState }>>;
  restoreDisplayProfile(payload?: { force?: boolean }): Promise<IpcResult<{ state: DisplayProfileState }>>;
  keepCurrentDisplayState(): Promise<IpcResult<{ state: DisplayProfileState }>>;
  onDisplayProfileUpdate(callback: (state: DisplayProfileState) => void): () => void;
}
export interface GameModeBackgroundState {
  phase: 'idle' | 'prepared' | 'active' | 'partial' | 'restored' | 'recovery_required';
  pendingRestore: boolean;
  hasSnapshot: boolean;
  durationMs: number;
  entries: { name: string; phase: 'untouched' | 'intent' | 'changed' | 'restoring' | 'restored' | 'skipped' | 'conflict'; code: string }[];
  apps: { pid?: number; name: string; status: 'closed' | 'skipped'; code?: string }[];
}
export interface GameModeBackgroundResult {
  ok: boolean;
  code?: string;
  message?: string;
  state?: GameModeBackgroundState;
}
export interface GameModeBackgroundApi {
  getGameModeBackgroundState(): Promise<GameModeBackgroundResult>;
  prepareGameModeBackground(): Promise<GameModeBackgroundResult>;
  applyGameModeBackground(): Promise<GameModeBackgroundResult>;
  restoreGameModeBackground(): Promise<GameModeBackgroundResult>;
}
declare global { interface Window { desktopApi: RestoreApi & DisplayProfileApi & TweakStateApi & GameModeBackgroundApi; } }
