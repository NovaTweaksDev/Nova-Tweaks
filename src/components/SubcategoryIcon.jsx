import {
  Activity,
  BatteryCharging,
  Boxes,
  Clock,
  Cpu,
  Download,
  EyeOff,
  Gpu,
  HardDrive,
  Layout,
  MemoryStick,
  Monitor,
  Mouse,
  MousePointer2,
  Package,
  Plug,
  Rocket,
  Server,
  Settings2,
  Share2,
  Shield,
  Shuffle,
  Timer,
  Wrench,
  Zap
} from 'lucide-react';
import MopSparklesIcon from './MopSparklesIcon';

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

const SUBCATEGORY_ICON_MAP = {
  general: {
    system: Monitor,
    cleanup: MopSparklesIcon,
    'power plans': BatteryCharging,
    maintenance: Wrench,
    security: Shield,
    updates: Download
  },
  latency: {
    input: MousePointer2 || Mouse,
    timer: Timer,
    'timer resolution': Clock
  },
  hardware: {
    cpu: Cpu,
    gpu: Gpu || Cpu,
    memory: MemoryStick,
    storage: HardDrive,
    power: Zap
  },
  debloat: {
    services: Settings2,
    privacy: EyeOff,
    apps: Package,
    interface: Layout
  },
  boot: {
    startup: Rocket,
    kernel: Cpu,
    hypervisor: Boxes
  },
  network: {
    'network latency': Activity,
    'tcp ip': Share2,
    adapter: Plug,
    'packet handling': Shuffle,
    dns: Server
  }
};

export function getSubcategoryIconComponent(category, subcategory) {
  const categoryKey = normalize(category);
  const subcategoryKey = normalize(subcategory).replace(/[\/_]+/g, ' ').replace(/\s+/g, ' ');
  return SUBCATEGORY_ICON_MAP[categoryKey]?.[subcategoryKey] || Monitor;
}

function SubcategoryIcon({ category, subcategory, className = 'h-4 w-4' }) {
  const Icon = getSubcategoryIconComponent(category, subcategory);
  return <Icon className={className} aria-hidden="true" strokeWidth={1.9} />;
}

export default SubcategoryIcon;
