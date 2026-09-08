const assert = require('node:assert/strict');
const test = require('node:test');
const { createLhmClient } = require('./lhmClient');

test('authenticates requests to the local LibreHardwareMonitor endpoint', async () => {
  const originalFetch = global.fetch;
  let capturedOptions = null;

  global.fetch = async (_endpoint, options) => {
    capturedOptions = options;
    return {
      ok: true,
      async json() {
        return { Children: [] };
      }
    };
  };

  try {
    const client = createLhmClient({
      username: 'nova',
      password: 'local-secret'
    });

    await client.fetchOnce();

    assert.equal(
      capturedOptions.headers.Authorization,
      `Basic ${Buffer.from('nova:local-secret', 'utf8').toString('base64')}`
    );
  } finally {
    global.fetch = originalFetch;
  }
});
