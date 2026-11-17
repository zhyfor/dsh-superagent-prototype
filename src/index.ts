/** Main plugin entry: mounts the Runtime and provides its restart callback for deployment account changes. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import { Runtime } from './app/runtime.ts'
import { Config, machineOf, type DeploymentConfig } from './deployment.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** State directory shared by the worker/router shell-environment wrappers of this dsh-superagent instance. */
    dshSuperagentEnvironment: { stateDir: string }
  }
}

export const name = 'dsh-superagent'
export const inject = ['agents', 'sessionController', 'sessionPersistence', 'workspaceRegistry', 'workingDirectory', 'permissionPresets', 'tools', 'systemPrompt', 'skills', 'webServer', 'connection', 'llm', 'subprocess']
export { Config }
export async function apply(ctx: Context, config: DeploymentConfig): Promise<void> {
  if (process.env.DSH_DISABLE_SUPERAGENT === '1') {
    ctx.logger.info('dsh-superagent is disabled by DSH_DISABLE_SUPERAGENT=1')
    return
  }
  const machine = machineOf(config)
  ctx.provide('dshSuperagentEnvironment', { stateDir: machine.stateDir })
  // The management panel provides its own settings UI, so disable DSH's auto-generated settings page.
  ctx.inject(['settings'], child => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
  // Volatile limits update in place without a restart; account changes restart dsh-superagent. DSH's settings service stops
  // serving this entry while dsh-superagent restarts and rereads it only on a configuration write, so trigger `describe()`
  // after restart to keep open configuration forms editable without a page reload.
  // TODO: drop the read once DSH's settings service rereads an entry whose plugin becomes active again.
  const restart = (): void => {
    ctx.fiber.restart().then(() => { ctx.get('settings')?.describe() }).catch((error: unknown) => { ctx.logger.error('dsh-superagent restart failed: %s', String(error)) })
  }
  const runtime = new Runtime(ctx, machine, restart)
  ctx.effect(() => async () => { await runtime.stop() })
  // 本插件作为 Host 的一行加载时，不能在 apply() 内等待 runtime.ready：
  // runtime 初始化会创建带 agentPreset 的 Session，而 preset 注册表在行处于
  // pending 时会调用 loader.await()，形成“自己等自己”的死锁。这里先让本行
  // 激活并发布 dshSuperagentEnvironment，启动结果之后异步记录。
  void runtime.ready.then(() => {
    ctx.logger.info(runtime.configured() ? 'dsh-superagent ready; the Superagent sidebar entry opens the management panel' : `dsh-superagent is waiting for setup: ${runtime.setupProblem?.detail ?? ''}`)
  }, (error: unknown) => {
    ctx.logger.error('dsh-superagent failed to start: %s', String(error))
  })
}
export type { Deployment, DeploymentConfig } from './deployment.ts'
export * from './core/index.ts'
