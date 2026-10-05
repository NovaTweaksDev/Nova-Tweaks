export type TweakState = 'enabled' | 'disabled';
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
declare global { interface Window { desktopApi: RestoreApi; } }
