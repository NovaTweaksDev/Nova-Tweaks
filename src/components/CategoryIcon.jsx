import { Boxes, Cpu, Grid2X2, MonitorCog, Network, Shield, Timer } from 'lucide-react';

function resolveCategoryIcon(category) {
  const key = String(category || '').trim().toLowerCase();
  if (key === 'all') return Grid2X2;
  if (key === 'latency') return Timer;
  if (key === 'hardware') return Cpu;
  if (key === 'debloat') return Shield;
  if (key === 'boot') return Boxes;
  if (key === 'network') return Network;
  return MonitorCog;
}

function CategoryIcon({ category, className = 'h-3.5 w-3.5' }) {
  const Icon = resolveCategoryIcon(category);
  return <Icon className={className} aria-hidden="true" strokeWidth={1.9} />;
}

export default CategoryIcon;
