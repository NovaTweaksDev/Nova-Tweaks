function createExecutionGate() {
  /** @type {symbol | null} */
  let owner = null;
  let running = 0;
  function busy() {
    return Object.assign(new Error('A restore or tweak operation is already running.'), { code: 'SYSTEM_OPERATION_BUSY' });
  }
  return {
    beginRestore() {
      if (owner || running) throw busy();
      owner = Symbol('restore');
      return owner;
    },
    /** @param {symbol} token */
    endRestore(token) { if (owner === token) owner = null; },
    /** @param {symbol | undefined} [token] */
    enter(token) {
      if (owner && token !== owner) throw busy();
      running += 1;
      let released = false;
      return () => { if (!released) { running -= 1; released = true; } };
    }
  };
}
module.exports = { createExecutionGate };
