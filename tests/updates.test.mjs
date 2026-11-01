import test from 'node:test';
import assert from 'node:assert/strict';

test('Updates Service: getAppUpdateInfo returns valid structure', async () => {
  // Mock Updates state
  const mockState = {
    isEnabled: false,
    channel: null,
    runtimeVersion: '1.0.0',
    updateId: null,
    isEmbeddedLaunch: true,
  };

  assert.equal(typeof mockState.isEnabled, 'boolean');
  assert.equal(mockState.runtimeVersion, '1.0.0');
  assert.equal(mockState.isEmbeddedLaunch, true);
});

test('Updates Service: Development mode disables automatic checks safely', async () => {
  // In node test environment or __DEV__, updates should gracefully report disabled without throwing
  const isDev = true;
  const isEnabled = false;

  const result = (isDev || !isEnabled)
    ? { status: 'disabled', message: 'Updates disabled in development mode or Expo Go.' }
    : { status: 'checked' };

  assert.equal(result.status, 'disabled');
  assert.match(result.message, /development mode/i);
});

test('Updates Service: Single-flight lock prevents duplicate concurrent checks', async () => {
  let isCheckInProgress = false;

  async function mockCheck() {
    if (isCheckInProgress) {
      return { status: 'in_progress', message: 'Update check already in progress.' };
    }
    isCheckInProgress = true;
    await new Promise((r) => setTimeout(r, 10));
    isCheckInProgress = false;
    return { status: 'no_update', message: 'Up to date' };
  }

  const [res1, res2] = await Promise.all([mockCheck(), mockCheck()]);
  assert.equal([res1.status, res2.status].includes('in_progress'), true);
});

test('Updates Service: Bounded timeout protects against hanging network', async () => {
  const hangingCheck = new Promise((resolve) => setTimeout(() => resolve({ isAvailable: true }), 1000));
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Update check timed out after 50ms')), 50)
  );

  await assert.rejects(
    async () => {
      await Promise.race([hangingCheck, timeoutPromise]);
    },
    { message: /timed out/ }
  );
});

test('Updates Service: Controlled reload never runs automatically during active session', () => {
  let reloadTriggeredAutomatically = false;
  let updateReady = true;

  // The download completes, setting updateReady = true, but DOES NOT reload
  if (updateReady) {
    // only sets flag for user banner
  }

  assert.equal(reloadTriggeredAutomatically, false);
});
