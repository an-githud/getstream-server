// scripts/lock-join-to-members.mjs
import dotenv from 'dotenv';
dotenv.config({ path: 'stream_api.env' });

import { StreamClient } from '@stream-io/node-sdk';

const API_KEY = process.env.STREAM_API_KEY;
const API_SECRET = process.env.STREAM_API_SECRET;
const CALL_TYPE = process.env.CALL_TYPE || 'default';

if (!API_KEY || !API_SECRET) {
  console.error('Missing STREAM_API_KEY / STREAM_API_SECRET');
  process.exit(1);
}

// 👉 tăng timeout lên 15s
const client = new StreamClient(API_KEY, API_SECRET, { timeout: 15000 });
const JOIN_CALL = 'join-call';

function asArray(x) { return Array.isArray(x) ? x : []; }
function uniq(arr) { return Array.from(new Set(arr)); }
function sameSet(a, b) {
  const A = uniq(a).sort(); const B = uniq(b).sort();
  return A.length === B.length && A.every((v, i) => v === B[i]);
}

try {
  const { call_types } = await client.video.listCallTypes();
  const ct = call_types[CALL_TYPE];
  if (!ct) {
    console.error(`Call type not found: ${CALL_TYPE}`);
    process.exit(1);
  }

  const grants = ct.grants || {};
  const userGrants = asArray(grants['user']);
  const memberGrants = asArray(grants['call_member']);

  const newUserGrants = userGrants.filter((g) => g !== JOIN_CALL);
  const newMemberGrants = uniq([...memberGrants, JOIN_CALL]);

  if (sameSet(userGrants, newUserGrants) && sameSet(memberGrants, newMemberGrants)) {
    console.log('Info: Grants already configured. Nothing to update.');
    process.exit(0);
  }

  await client.video.updateCallType({
    name: CALL_TYPE,
    grants: {
      ...grants,
      user: newUserGrants,
      call_member: newMemberGrants,
    },
  });

  console.log(`OK: Updated ${CALL_TYPE} so only 'call_member' has '${JOIN_CALL}'.`);
  process.exit(0);
} catch (e) {
  console.error('Failed to update call type grants:', e);
  process.exit(1);
}
