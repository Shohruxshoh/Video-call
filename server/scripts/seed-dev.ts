// Dev-only seed: creates the "men / ali / vali" accounts from the privacy example.
// men is friends with ali and with vali; ali and vali are NOT friends and must not see each other.
// Never run this against a production database.
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/db.ts';
import { hashPassword } from '../src/crypto.ts';

const DEV_PASSWORD = 'dev-parol-123';
const USERS = [
  ['men', 'Men'],
  ['ali', 'Ali'],
  ['vali', 'Vali'],
] as const;

if (process.env.NODE_ENV === 'production') throw new Error('seed-dev must not run in production');

const db = openDb(loadConfig().dbPath);
const ids = new Map<string, number>();
const now = Date.now();
for (const [username, displayName] of USERS) {
  const id = db.createUser(username, displayName, await hashPassword(DEV_PASSWORD), now) ?? db.userByUsername(username)!.id;
  ids.set(username, id);
}
for (const friend of ['ali', 'vali']) {
  const token = `seed-${friend}-${now}`;
  db.createInvite(token, ids.get('men')!, now, now + 60_000);
  db.acceptInvite(token, ids.get(friend)!, now);
}
db.close();
console.log(`Seeded users ${USERS.map((u) => u[0]).join(', ')} (password: ${DEV_PASSWORD})`);
