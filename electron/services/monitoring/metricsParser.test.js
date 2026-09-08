const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMonitoringSensors } = require('./metricsParser');

test('parses preferred CPU and dedicated GPU temperatures from LHM sensor data', () => {
  const metrics = parseMonitoringSensors({
    Children: [
      {
        HardwareId: '/cpu/0',
        Text: 'AMD Ryzen Processor',
        Children: [
          { Text: 'Core #1', Type: 'Temperature', RawValue: 58 },
          { Text: 'CPU Package', Type: 'Temperature', RawValue: 62.5 }
        ]
      },
      {
        HardwareId: '/gpu-intel/0',
        Text: 'Intel Iris Xe Graphics',
        Children: [
          { Text: 'GPU Core', Type: 'Temperature', RawValue: 48 }
        ]
      },
      {
        HardwareId: '/gpu-nvidia/0',
        Text: 'NVIDIA GeForce RTX',
        Children: [
          { Text: 'GPU Core', Type: 'Temperature', RawValue: 67 }
        ]
      }
    ]
  });

  assert.equal(metrics.cpuTemp, 62.5);
  assert.equal(metrics.gpuTemp, 67);
});

test('returns no temperatures when LHM exposes no plausible sensor values', () => {
  const metrics = parseMonitoringSensors({
    Children: [
      {
        HardwareId: '/cpu/0',
        Text: 'CPU',
        Children: [{ Text: 'CPU Package', Type: 'Temperature', RawValue: 0 }]
      },
      {
        HardwareId: '/gpu-nvidia/0',
        Text: 'NVIDIA GPU',
        Children: [{ Text: 'GPU Core', Type: 'Temperature', RawValue: 175 }]
      }
    ]
  });

  assert.equal(metrics.cpuTemp, null);
  assert.equal(metrics.gpuTemp, null);
});

test('does not treat an APU CPU temperature as a GPU temperature', () => {
  const metrics = parseMonitoringSensors({
    Children: [
      {
        HardwareId: '/amdcpu/0',
        Text: 'AMD Ryzen 5 8640HS w/ Radeon 760M Graphics',
        Children: [{ Text: 'Core (Tctl/Tdie)', Type: 'Temperature', RawValue: 41.25 }]
      }
    ]
  });

  assert.equal(metrics.cpuTemp, 41.25);
  assert.equal(metrics.gpuTemp, null);
});
