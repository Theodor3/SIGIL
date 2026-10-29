// Read-only adapter. Never sends a mutation to the swarm or opens its database.
export const EXPECTED_STORE = 'store_4b6c94a3538f4cb4';
const endpoint = '';
export function createLiveAdapter(fetcher = fetch) {
  let lastGood;
  return async function read() {
    const checked_at = new Date().toISOString();
    try {
      const get = async route => {
        const response = await fetcher(endpoint + route, {signal: AbortSignal.timeout(3000), cache: 'no-store'});
        if (!response.ok) throw Error('HTTP ' + response.status);
        return response.json();
      };
      const health = await get('/api/health');
      if (health.app !== 'sigil-swarm' || health.storage?.store_id !== EXPECTED_STORE) {
        lastGood = undefined;
        return {available:false, stale:false, checked_at, tasks:[], message:'Identity mismatch. Live records hidden; expected ' + EXPECTED_STORE};
      }
      const state = await get('/api/state');
      if (state.runtime?.storage?.store_id !== EXPECTED_STORE || !Array.isArray(state.missions)) {
        lastGood = undefined;
        return {available:false, stale:false, checked_at, tasks:[], message:'State identity or schema mismatch. Live records hidden.'};
      }
      lastGood = {
        available:true, stale:false, checked_at, fetched_at:new Date().toISOString(),
        store_id:EXPECTED_STORE, source:'same-origin swarm', mode:state.runtime.label || state.runtime.status || 'unknown',
        active_mission_id:state.active_mission_id, blockers:state.runtime.blockers || [],
        tasks:state.missions.slice(0,100).map(m=>({id:m.id, objective:m.title, role:m.local_role || m.mode, status:m.review_resolution ? m.status + ' (review: ' + m.review_resolution.disposition + ')' : m.status, updated:m.updated_at, reason:m.status_reason || ''})),
        message:'Verified live swarm ' + EXPECTED_STORE + '. Recorded mission statuses; refreshes every 30 seconds.'
      };
      return lastGood;
    } catch {
      if (lastGood) return {...lastGood, available:false, stale:true, checked_at, message:'Live swarm unavailable. Showing last verified records from ' + lastGood.fetched_at};
      return {available:false, stale:false, checked_at, tasks:[], message:'Live swarm unavailable. No verified records cached.'};
    }
  };
}
