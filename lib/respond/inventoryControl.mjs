// Same PostgreSQL platform, separate control capability; never business data credentials.
// No cache/fallback: every admission and every successful response checks central state.
export function createInventoryControl({getClient, capability, timeoutMs = 750}) {
  const call = async (action, generation = null) => {
    const secret = capability();
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(secret || '')) throw Error('control_unavailable');
    const controller = new AbortController();
    let timer;
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => getClient().rpc('respond_inventory_gate', {
          p_capability: secret, p_action: action, p_generation: generation,
        }).abortSignal(controller.signal)),
        new Promise((_, reject) => { timer = setTimeout(() => {
          controller.abort(); reject(Error('control_unavailable'));
        }, timeoutMs); }),
      ]);
      if (result?.error || !result?.data || typeof result.data !== 'object') throw Error('control_unavailable');
      const data = result.data;
      if (data.status === 'disabled') throw Error('control_disabled');
      if (data.status === 'limited') throw Error('control_rate_limited');
      if (data.status !== 'allowed' || !Number.isSafeInteger(data.generation) || data.generation < 1
        || (action === 'check' && data.generation !== generation)) throw Error('control_unavailable');
      return data.generation;
    } catch(e) {
      if (['control_disabled','control_rate_limited'].includes(e?.message)) throw e;
      throw Error('control_unavailable');
    } finally { clearTimeout(timer); }
  };
  return {consume: () => call('consume'), check: generation => call('check', generation)};
}
