import { useEffect, useState } from 'react';

export function useRestoreJobs() {
  const [jobs, setJobs] = useState(/** @type {import('../../shared/desktopContracts').RestoreJob[]} */ ([]));
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    const api = window.desktopApi;
    /** @param {import('../../shared/desktopContracts').RestoreJob} job */
    const update = (job) => {
      if (!disposed) setJobs((previous) => [job, ...previous.filter((entry) => entry.id !== job.id)]);
    };
    const unsubscribe = api?.onBackupRestoreUpdate?.(update);
    // List after subscribing so a renderer reopened during execution gets current progress.
    api?.listBackupRestores?.().then((result) => {
      if (disposed) return;
      if (result?.ok) setJobs((current) => {
        const merged = new Map(current.map((job) => [job.id, job]));
        for (const job of result.jobs) {
          const previous = merged.get(job.id);
          if (!previous || job.revision > previous.revision) merged.set(job.id, job);
        }
        return [...merged.values()];
      });
      else setError(result?.message || 'Restore journal unavailable.');
    }).catch((reason) => { if (!disposed) setError(reason.message); });
    return () => { disposed = true; unsubscribe?.(); };
  }, []);
  return { jobs, error };
}
