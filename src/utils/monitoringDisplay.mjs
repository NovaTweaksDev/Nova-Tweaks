// Display histories use measurement time, never the arrival time of an IPC update.
export function shouldAppendMonitoringSample(sample, previous, now = Date.now()) {
  if (!sample || (sample.sampleKind && sample.sampleKind !== 'measurement') || sample.monitoring === 'offline') return false;
  const timestamp = sample.sampleKind ? sample.measuredAt : sample.timestamp;
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now || now - timestamp > 15000) return false;
  if (sample.sampleId != null && (!Number.isSafeInteger(sample.sampleId) || sample.sampleId <= 0)) return false;
  if (!previous) return true;
  const previousTime = previous.measuredAt ?? previous.timestamp;
  if (timestamp < previousTime) return false;
  if (sample.sampleId != null && previous.sampleId != null) return sample.sampleId > previous.sampleId;
  return timestamp > previousTime;
}
