// Only Nova-owned files are signed. Upstream signatures and bytes remain untouched.
module.exports = [
  { from: 'tools/nova-admin-broker/bin', files: ['NovaAdminBrokerHost.exe'] },
  { from: 'tools/nvidia-profile-helper/bin', files: ['nvidia-profile-helper.exe'], policy: 'nvidia-profile-helper' },
  { from: 'tools/nvidia-display-helper/bin', files: ['nvidia-display-helper.exe'], policy: 'nvidia-display-helper' },
  { from: 'resources/tools/nova-presentmon-helper', files: ['NovaPresentMonHelper.exe'], policy: 'presentmon-helper' },
  { from: 'resources/helpers/NovaGameDetector/publish/win-x64', files: ['NovaGameDetector.exe', 'NovaGameDetector.dll'], policy: 'game-detector-x64' }
];
