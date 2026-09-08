import {
  BadgeCheck,
  Boxes,
  ChevronsUpDown,
  DatabaseBackup,
  Eye,
  Gauge,
  Gamepad2,
  Gem,
  Ghost,
  House,
  KeyRound,
  LogOut,
  Mail,
  MoreHorizontal,
  RefreshCw,
  Rocket,
  Search,
  SendHorizontal,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SquareCheckBig,
  SquareDashedMousePointer,
  Trash2,
  TrendingUp,
  User,
  UserCog,
  UserRound,
  UserPlus,
  UserRoundCheck
} from 'lucide-react';

const DEFAULT_ICON_SIZE = 18;
const DEFAULT_STROKE_WIDTH = 1.8;

function createIcon(LucideIcon, defaultSize = DEFAULT_ICON_SIZE) {
  return function AppIcon({ className, size = defaultSize, strokeWidth = DEFAULT_STROKE_WIDTH, ...props }) {
    return (
      <LucideIcon
        aria-hidden="true"
        focusable="false"
        className={className}
        size={size}
        strokeWidth={strokeWidth}
        {...props}
      />
    );
  };
}

const AccountIcon = createIcon(User);
const AdminIcon = createIcon(ShieldCheck);
const DotsMenuIcon = createIcon(MoreHorizontal);
const EmailIcon = createIcon(Mail);
const ExpandIcon = createIcon(ChevronsUpDown);
const GameModeAffinityIcon = createIcon(SquareCheckBig);
const GameModeDetectionIcon = createIcon(SquareDashedMousePointer);
const GameModeFullscreenIcon = createIcon(BadgeCheck);
const GameModeGamingIcon = createIcon(Gamepad2);
const GameModePriorityIcon = createIcon(Rocket);
const GuestIcon = createIcon(Ghost);
const LockIcon = createIcon(KeyRound);
const LogoutIcon = createIcon(LogOut);
const NavAppsIcon = createIcon(Boxes);
const NavAiAssistIcon = createIcon(Sparkles);
const NavAiIcon = createIcon(SendHorizontal);
const NavAiTabIcon = createIcon(Sparkles);
const NavBackupIcon = createIcon(DatabaseBackup);
const NavGameModeIcon = createIcon(Gamepad2);
const NavHomeIcon = createIcon(House);
const NavOverviewIcon = createIcon(Gauge);
const NavSettingsIcon = createIcon(Settings);
const NavTweaksIcon = createIcon(SlidersHorizontal);
const OptimizeIcon = createIcon(TrendingUp);
const RegisterIcon = createIcon(UserPlus);
const RuntimeAccessIcon = createIcon(UserRoundCheck);
const SearchIcon = createIcon(Search);
const SortIcon = createIcon(SlidersHorizontal);
const SyncIcon = createIcon(RefreshCw);
const TrashIcon = createIcon(Trash2);
const UpgradeIcon = createIcon(Gem);
const UserRoundIcon = createIcon(UserRound);
const UsernameIcon = createIcon(UserCog);
const VisibleIcon = createIcon(Eye);

export {
  AccountIcon,
  AdminIcon,
  DotsMenuIcon,
  EmailIcon,
  ExpandIcon,
  GameModeAffinityIcon,
  GameModeDetectionIcon,
  GameModeFullscreenIcon,
  GameModeGamingIcon,
  GameModePriorityIcon,
  GuestIcon,
  LockIcon,
  LogoutIcon,
  NavAppsIcon,
  NavAiAssistIcon,
  NavAiIcon,
  NavAiTabIcon,
  NavBackupIcon,
  NavGameModeIcon,
  NavHomeIcon,
  NavOverviewIcon,
  NavSettingsIcon,
  NavTweaksIcon,
  OptimizeIcon,
  RegisterIcon,
  RuntimeAccessIcon,
  SearchIcon,
  SortIcon,
  SyncIcon,
  TrashIcon,
  UpgradeIcon,
  UserRoundIcon,
  UsernameIcon,
  VisibleIcon
};
