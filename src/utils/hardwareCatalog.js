import bundledCpuCatalog from '../data/hardware/nova-tweaks-cpu-catalog.json';
import bundledGpuCatalog from '../data/hardware/nova-tweaks-gpu-catalog.json';
export { getCatalogEntries, matchHardwareCatalogEntry } from './hardwareMatcher.mjs';

export const bundledHardwareCatalogs = {
  cpu: bundledCpuCatalog,
  gpu: bundledGpuCatalog
};
