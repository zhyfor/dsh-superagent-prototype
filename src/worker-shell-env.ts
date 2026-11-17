/**
 * Worker-only shell environment: wraps the isolated `ctx.shell` of a worker or router preset so every command carries the
 * deployment's git configuration and CLI shim PATH. It runs inside each preset's isolated shell group; the DSH Host and
 * personal Sessions use their own environment and `process.env` is never mutated.
 */
import type { Context } from '@deepseek-ai/cordis'
import { workerEnvironment } from './infra/environment.ts'

export const name = 'worker-shell-env'
export const inject = ['shell', 'dshSuperagentEnvironment']

interface ShellRequestLike { command: string; [key: string]: unknown }
interface ShellSpecLike { env?: Record<string, string>; [key: string]: unknown }
interface ShellLike { resolve(request: ShellRequestLike): ShellSpecLike }

export function apply(ctx: Context): void {
  const shell = (ctx as unknown as { shell: ShellLike }).shell
  const { stateDir } = ctx.dshSuperagentEnvironment
  const resolve = shell.resolve.bind(shell)
  shell.resolve = (request: ShellRequestLike): ShellSpecLike => {
    const spec = resolve(request)
    return { ...spec, env: { ...workerEnvironment(stateDir), ...spec.env } }
  }
}
