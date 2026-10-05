import { useCallback } from 'react';

// Poll only while this caller is waiting; events power the persistent progress panel.
/** @param {(job: import('../../shared/desktopContracts').RestoreJob) => Promise<void>} onFinished */
export function useBackupRestore(onFinished) {
  return useCallback(/** @param {{id?: string, scope?: string[], resumeId?: string}} request */ async (request) => {
    const api = window.desktopApi;
    const result = request.resumeId
      ? await api.resumeBackupRestore({ id: request.resumeId })
      : await api.startBackupRestore({ id: request.id || '', scope: request.scope });
    if (!result.ok) return { ...result, errors: [{ code: result.code, message: result.message }] };
    let job = result.job;
    while (['prepared', 'running'].includes(job.status)) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const status = await api.getBackupRestoreStatus({ id: job.id });
      if (!status.ok) throw new Error(status?.message || 'Restore status unavailable.');
      job = status.job;
    }
    await onFinished(job);
    return job;
  }, [onFinished]);
}
