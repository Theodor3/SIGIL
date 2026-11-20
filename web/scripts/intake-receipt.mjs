// Recompute the full receipt from aggregate evidence; a stored success flag is not proof.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {ID, ROOT, loadContext, checkReceipt} from './intake-study.mjs';

export {validateReceipt} from './intake-study.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw new Error('usage: node scripts/intake-receipt.mjs');
    const candidatePath = path.join(ROOT, `.swarm/candidates/${ID}.json`);
    const result = checkReceipt(loadContext(), candidatePath);
    console.log(JSON.stringify({status: 'passed', receiptMatchesRecomputedAcceptance: true, ...result}, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
