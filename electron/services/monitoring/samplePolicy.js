const MAX_SAMPLE_AGE_MS = 15000;

function isFreshTime(timestamp, now) {
  return typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0
    && timestamp <= now && now - timestamp <= MAX_SAMPLE_AGE_MS;
}

function readMeasurement(metrics, now = Date.now()) {
  if (!metrics || (metrics.sampleKind && metrics.sampleKind !== 'measurement') || metrics.monitoring === 'offline') return null;
  const measuredAt = metrics.sampleKind ? metrics.measuredAt : metrics.timestamp;
  if (!isFreshTime(measuredAt, now)) return null;
  const sampleId = metrics.sampleId ?? null;
  if (sampleId !== null && (!Number.isSafeInteger(sampleId) || sampleId <= 0)) return null;
  return { measuredAt, sampleId };
}

function isNewMeasurement(measurement, previous) {
  if (!measurement) return false;
  if (!previous) return true;
  if (measurement.measuredAt < previous.measuredAt) return false;
  if (measurement.sampleId !== null && previous.sampleId !== null) return measurement.sampleId > previous.sampleId;
  return measurement.measuredAt > previous.measuredAt;
}

function networkMeasurementTime(quality, now = Date.now()) {
  if (!quality || ['unavailable', 'blocked'].includes(quality.status)) return null;
  const timestamp = typeof quality.lastChecked === 'string' ? Date.parse(quality.lastChecked) : quality.lastChecked;
  return isFreshTime(timestamp, now) ? timestamp : null;
}

module.exports = { MAX_SAMPLE_AGE_MS, isFreshTime, readMeasurement, isNewMeasurement, networkMeasurementTime };
