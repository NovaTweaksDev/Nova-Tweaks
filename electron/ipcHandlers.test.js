const test = require('node:test');
const assert = require('node:assert/strict');

const { registerTweakExecutionIpcHandlers } = require('./ipcHandlers');

function createFixture() {
  const handlers = new Map();
  const requirements = [];
  let executionCount = 0;
  registerTweakExecutionIpcHandlers({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    tweakRunner: {
      getConfig: async () => ({}),
      getExecutionRequirements: async (job) => {
        requirements.push(job);
        return { ...job, requiresAdmin: job.tweakId === 'admin-tweak' };
      },
      runTweak: async () => {
        executionCount += 1;
        return { ok: true };
      }
    },
    isAuthenticated: () => true,
    toIpcError: (error) => ({ code: error.code || 'ERROR', message: error.message, details: {} })
  });
  return { handlers, requirements, getExecutionCount: () => executionCount };
}

test('preflights every batch entry without executing a partial tweak batch', async () => {
  const fixture = createFixture();
  const result = await fixture.handlers.get('api:tweaks:preflight')(null, { jobs: [
    { id: 'normal-tweak', targetState: 'enabled', params: {} },
    { id: 'admin-tweak', targetState: 'disabled', params: { Value: 10 } }
  ] });
  assert.equal(result.ok, true);
  assert.equal(result.requiresAdmin, true);
  assert.equal(fixture.requirements.length, 2);
  assert.equal(fixture.getExecutionCount(), 0);
});

test('rejects an invalid preflight batch before any execution', async () => {
  const fixture = createFixture();
  const result = await fixture.handlers.get('api:tweaks:preflight')(null, { jobs: [
    { id: 'normal-tweak', targetState: 'enabled', params: {} },
    { id: 'admin-tweak', targetState: 'enabled', params: [] }
  ] });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'INVALID_PAYLOAD');
  assert.equal(fixture.getExecutionCount(), 0);
});
