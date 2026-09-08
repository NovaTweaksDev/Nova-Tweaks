import test from 'node:test';
import assert from 'node:assert/strict';
import { matchHardwareCatalogEntry } from './hardwareMatcher.mjs';

test('prefers a specific GPU variant over a shorter prefix match', () => {
  const catalog = {
    gpus: [
      {
        id: 'rtx_4070',
        model: 'RTX 4070',
        canonicalName: 'NVIDIA RTX 4070',
        matchRegex: '(?i)\\b(?:NVIDIA\\s+)?(?:GeForce\\s+)?RTX\\s+4070\\b'
      },
      {
        id: 'rtx_4070_super',
        model: 'RTX 4070 SUPER',
        canonicalName: 'NVIDIA RTX 4070 SUPER',
        matchRegex: '(?i)\\b(?:NVIDIA\\s+)?(?:GeForce\\s+)?RTX\\s+4070\\s+SUPER\\b'
      }
    ]
  };

  assert.equal(
    matchHardwareCatalogEntry('NVIDIA GeForce RTX 4070 SUPER', catalog, 'gpu')?.id,
    'rtx_4070_super'
  );
});

test('matches a Windows CPU name containing core count and processor suffix', () => {
  const catalog = {
    cpus: [{
      id: 'ryzen_7_7800x3d',
      model: 'Ryzen 7 7800X3D',
      canonicalName: 'AMD Ryzen 7 7800X3D',
      matchPattern: '(?:AMD\\s+)?(?:Ryzen\\s+7\\s+7800X3D)',
      matchFlags: 'i'
    }]
  };

  assert.equal(
    matchHardwareCatalogEntry('AMD Ryzen 7 7800X3D 8-Core Processor', catalog, 'cpu')?.id,
    'ryzen_7_7800x3d'
  );
});

test('ignores invalid catalog regexes without breaking the modal', () => {
  const catalog = {
    gpus: [{ id: 'invalid', model: 'Unknown', matchRegex: '(?i)[' }]
  };

  assert.equal(matchHardwareCatalogEntry('NVIDIA GeForce RTX 5090', catalog, 'gpu'), null);
});
