import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface PublicUser {
  id: number;
  username: string;
  displayName: string;
}

export interface Message {
  id: number;
  from: number;
  to: number;
  cid: string;
  body: string;
  at: number;
  readAt: number | null;
}

export interface FriendRow extends PublicUser {
  since: number;
  unread: number;
  /** Highest id of my messages this friend has read. */
  peerRead: number | null;
  lastId: number | null;
  lastFrom: number | null;
  lastBody: string | null;
  lastAt: number | null;
}

export interface InviteRow {
  token: string;
  inviterId: number;
  createdAt: number;
  expiresAt: number;
  usedBy: number | null;
}

export type AcceptResult =
  | { ok: true; inviterId: number; created: boolean }
  | { ok: false; error: 'invalid' | 'self' };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY,
  username     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  pass_hash    TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS invites (
  token      TEXT PRIMARY KEY,
  inviter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  used_at    INTEGER
);
CREATE INDEX IF NOT EXISTS invites_inviter ON invites(inviter_id);

-- One row per friendship, always stored with user_a < user_b.
CREATE TABLE IF NOT EXISTS friendships (
  user_a     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS friendships_b ON friendships(user_b);

CREATE TABLE IF NOT EXISTS messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id    TEXT NOT NULL,
  body         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  read_at      INTEGER,
  UNIQUE (sender_id, client_id)
);
CREATE INDEX IF NOT EXISTS messages_pair ON messages(sender_id, recipient_id, id);
CREATE INDEX IF NOT EXISTS messages_sender ON messages(sender_id, id);
CREATE INDEX IF NOT EXISTS messages_recipient ON messages(recipient_id, id);
`;

const MSG_COLS =
  'id, sender_id AS "from", recipient_id AS "to", client_id AS cid, body, created_at AS at, read_at AS readAt';
const USER_COLS = 'id, username, display_name AS displayName';

const pair = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a]);

export type Db = ReturnType<typeof openDb>;

export function openDb(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  db.exec(SCHEMA);

  const q = {
    insertUser: db.prepare(
      'INSERT INTO users (username, display_name, pass_hash, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
    ),
    userByUsername: db.prepare(`SELECT ${USER_COLS}, pass_hash AS passHash FROM users WHERE username = ?`),
    userById: db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`),

    insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    userBySession: db.prepare(
      `SELECT u.id, u.username, u.display_name AS displayName FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    ),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),

    insertInvite: db.prepare('INSERT INTO invites (token, inviter_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    countActiveInvites: db.prepare(
      'SELECT COUNT(*) AS n FROM invites WHERE inviter_id = ? AND used_by IS NULL AND expires_at > ?',
    ),
    listInvites: db.prepare(
      `SELECT token, inviter_id AS inviterId, created_at AS createdAt, expires_at AS expiresAt, used_by AS usedBy
       FROM invites WHERE inviter_id = ? AND used_by IS NULL AND expires_at > ? ORDER BY created_at DESC`,
    ),
    inviteByToken: db.prepare(
      `SELECT token, inviter_id AS inviterId, created_at AS createdAt, expires_at AS expiresAt, used_by AS usedBy
       FROM invites WHERE token = ?`,
    ),
    useInvite: db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE token = ? AND used_by IS NULL'),
    deleteInvite: db.prepare('DELETE FROM invites WHERE token = ? AND inviter_id = ? AND used_by IS NULL'),
    purgeInvites: db.prepare('DELETE FROM invites WHERE expires_at <= ? OR used_at <= ?'),

    insertFriendship: db.prepare(
      'INSERT INTO friendships (user_a, user_b, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
    ),
    areFriends: db.prepare('SELECT 1 AS x FROM friendships WHERE user_a = ? AND user_b = ?'),
    deleteFriendship: db.prepare('DELETE FROM friendships WHERE user_a = ? AND user_b = ?'),
    friendIds: db.prepare(
      'SELECT CASE WHEN user_a = :me THEN user_b ELSE user_a END AS id FROM friendships WHERE user_a = :me OR user_b = :me',
    ),
    listFriends: db.prepare(`
      WITH fr AS (
        SELECT CASE WHEN user_a = :me THEN user_b ELSE user_a END AS fid, created_at
        FROM friendships WHERE user_a = :me OR user_b = :me
      )
      SELECT u.id, u.username, u.display_name AS displayName, fr.created_at AS since,
        (SELECT COUNT(*) FROM messages m
          WHERE m.sender_id = fr.fid AND m.recipient_id = :me AND m.read_at IS NULL) AS unread,
        (SELECT MAX(id) FROM messages m
          WHERE m.sender_id = :me AND m.recipient_id = fr.fid AND m.read_at IS NOT NULL) AS peerRead,
        lm.id AS lastId, lm.sender_id AS lastFrom, lm.body AS lastBody, lm.created_at AS lastAt
      FROM fr
      JOIN users u ON u.id = fr.fid
      LEFT JOIN messages lm ON lm.id = (
        SELECT MAX(id) FROM messages m
        WHERE (m.sender_id = fr.fid AND m.recipient_id = :me) OR (m.sender_id = :me AND m.recipient_id = fr.fid)
      )
      ORDER BY COALESCE(lm.created_at, fr.created_at) DESC`),

    insertMessage: db.prepare(
      `INSERT INTO messages (sender_id, recipient_id, client_id, body, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (sender_id, client_id) DO NOTHING`,
    ),
    messageByCid: db.prepare(`SELECT ${MSG_COLS} FROM messages WHERE sender_id = ? AND client_id = ?`),
    conversation: db.prepare(`
      SELECT ${MSG_COLS} FROM messages
      WHERE ((sender_id = :a AND recipient_id = :b) OR (sender_id = :b AND recipient_id = :a)) AND id < :before
      ORDER BY id DESC LIMIT :limit`),
    messagesSince: db.prepare(`
      SELECT ${MSG_COLS} FROM messages m
      WHERE m.id > :since AND (m.sender_id = :me OR m.recipient_id = :me)
        AND EXISTS (SELECT 1 FROM friendships f
          WHERE f.user_a = min(m.sender_id, m.recipient_id) AND f.user_b = max(m.sender_id, m.recipient_id))
      ORDER BY m.id LIMIT :limit`),
    markRead: db.prepare(`
      UPDATE messages SET read_at = :now
      WHERE recipient_id = :reader AND sender_id = :peer AND id <= :upTo AND read_at IS NULL`),
  };

  function tx<T>(fn: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  return {
    close: () => db.close(),

    createUser(username: string, displayName: string, passHash: string, now: number): number | null {
      const r = q.insertUser.run(username, displayName, passHash, now);
      return r.changes ? Number(r.lastInsertRowid) : null;
    },
    userByUsername: (username: string) =>
      q.userByUsername.get(username) as (PublicUser & { passHash: string }) | undefined,
    userById: (id: number) => q.userById.get(id) as PublicUser | undefined,

    createSession(tokenHash: string, userId: number, now: number, expiresAt: number) {
      q.insertSession.run(tokenHash, userId, now, expiresAt);
    },
    userBySession: (tokenHash: string, now: number) => q.userBySession.get(tokenHash, now) as PublicUser | undefined,
    deleteSession(tokenHash: string) {
      q.deleteSession.run(tokenHash);
    },

    createInvite(token: string, inviterId: number, now: number, expiresAt: number) {
      q.insertInvite.run(token, inviterId, now, expiresAt);
    },
    countActiveInvites: (userId: number, now: number) => (q.countActiveInvites.get(userId, now) as { n: number }).n,
    listInvites: (userId: number, now: number) => q.listInvites.all(userId, now) as unknown as InviteRow[],
    inviteByToken: (token: string) => q.inviteByToken.get(token) as InviteRow | undefined,
    deleteInvite: (token: string, userId: number) => Number(q.deleteInvite.run(token, userId).changes) > 0,

    /** Single-use: the first account to accept consumes the invite. */
    acceptInvite(token: string, userId: number, now: number): AcceptResult {
      return tx(() => {
        const inv = q.inviteByToken.get(token) as InviteRow | undefined;
        if (!inv) return { ok: false, error: 'invalid' } as const;
        if (inv.inviterId === userId) return { ok: false, error: 'self' } as const;
        // Retried request from the same person after a lost response: report success again.
        if (inv.usedBy === userId) return { ok: true, inviterId: inv.inviterId, created: false } as const;
        if (inv.usedBy !== null || inv.expiresAt <= now) return { ok: false, error: 'invalid' } as const;
        q.useInvite.run(userId, now, token);
        const [a, b] = pair(inv.inviterId, userId);
        const created = Number(q.insertFriendship.run(a, b, now).changes) > 0;
        return { ok: true, inviterId: inv.inviterId, created } as const;
      });
    },

    areFriends(a: number, b: number): boolean {
      if (a === b) return false;
      const [x, y] = pair(a, b);
      return q.areFriends.get(x, y) !== undefined;
    },
    friendIds: (userId: number) => (q.friendIds.all({ me: userId }) as { id: number }[]).map((r) => r.id),
    listFriends: (userId: number) => q.listFriends.all({ me: userId }) as unknown as FriendRow[],
    removeFriend(a: number, b: number): boolean {
      const [x, y] = pair(a, b);
      return Number(q.deleteFriendship.run(x, y).changes) > 0;
    },

    /** Idempotent on (sender, cid) so clients can safely resend after reconnecting. */
    insertMessage(from: number, to: number, cid: string, body: string, now: number) {
      const created = Number(q.insertMessage.run(from, to, cid, body, now).changes) > 0;
      const message = q.messageByCid.get(from, cid) as unknown as Message;
      return { message, created };
    },
    conversation(a: number, b: number, before: number, limit: number): Message[] {
      return (q.conversation.all({ a, b, before, limit }) as unknown as Message[]).reverse();
    },
    messagesSince: (me: number, since: number, limit: number) =>
      q.messagesSince.all({ me, since, limit }) as unknown as Message[],
    markRead: (reader: number, peer: number, upTo: number, now: number) =>
      Number(q.markRead.run({ reader, peer, upTo, now }).changes),

    purgeExpired(now: number) {
      q.purgeSessions.run(now);
      q.purgeInvites.run(now, now - 30 * 24 * 3600 * 1000);
    },
  };
}
