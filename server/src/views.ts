import type { FriendRow } from './db.ts';

export function toFriend(row: FriendRow, online: boolean) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.displayName,
    since: row.since,
    online,
    unread: row.unread,
    peerRead: row.peerRead ?? 0,
    last: row.lastId === null ? null : { id: row.lastId, from: row.lastFrom, body: row.lastBody, at: row.lastAt },
  };
}

export type Friend = ReturnType<typeof toFriend>;
