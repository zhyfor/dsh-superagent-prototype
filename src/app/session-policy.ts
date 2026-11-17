/** Session-policy helpers: the only Sessions dsh-superagent owns, and which workspace paths it manages. */
import { key } from '../core/index.ts'
import { isAbsolute, relative, resolve, sep } from 'node:path'

/** Returns the one assessment Session ID for a Thread key (`assess-<hash>`), reused for every message on that Thread. */
export const assessSessionId = (thread: string): string => `assess-${key(thread)}`
/** Whether `sessionId` names an assessment Session. */
export const isAssessSession = (sessionId: string): boolean => sessionId.startsWith('assess-')
/** Returns the IDs of every Session dsh-superagent owns: one assessment Session per Thread and one worker per live Ticket. */
export function managedSessionIds(threads: readonly { key: string }[], tickets: readonly { id: string }[]): string[] {
  return [...threads.map(thread => assessSessionId(thread.key)), ...tickets.map(ticket => `worker-${ticket.id}`)]
}

/** Whether `path` is `root` or a descendant of it, after resolving both. */
export function withinRoot(root: string, path: string): boolean {
  if (!root || !path) return false
  const rel = relative(resolve(root), resolve(path))
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

/** Whether `path` is inside at least one managed root. */
export function withinAnyRoot(roots: readonly string[], path: string): boolean {
  return roots.some(root => withinRoot(root, path))
}
