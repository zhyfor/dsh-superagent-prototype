/** Feishu topic to task-ledger Issue bridge: menu text, command parsing, dedupe, and reply flow. */
import { key, type Trigger } from '../core/index.ts'
import { KV } from '../kv.ts'
import type { SourceContext } from './host.ts'
import { appendGithubIssue, createGithubIssue, type GithubIssueLink } from './github-channel.ts'

export const TASK_LEDGER = 'zhyfor/dshSuperagentRepo'
export const ISSUE_MENU_MARK = '是否将此话题转为 GitHub Issue？'
const asked = new Set<string>()
/** Test hook: forgets which topics already showed the menu during this process. */
export function resetIssueMenuState(): void { asked.clear() }
/** True until this topic has had one menu prompt in this process. */
export const shouldAskIssueMenu = (thread: string): boolean => !asked.has(thread)
export const markIssueAsked = (thread: string): void => { asked.add(thread) }

/** The exact text menu required by the governance plan; `existing` switches to append/create/chat wording. */
export function issueMenu(existing?: Pick<GithubIssueLink, 'number'>): string {
  return existing
    ? `是否将此话题转为 GitHub Issue？\n1. 追加到 #${existing.number}\n2. 新建 Issue\n3. 仅聊天，不转`
    : `是否将此话题转为 GitHub Issue？\n1. 转 Issue\n2. 仅聊天，不转\n3. 稍后再说`
}
export function appendIssueMenu(text: string, existing?: Pick<GithubIssueLink, 'number'>): string {
  return text.includes(ISSUE_MENU_MARK) ? text : `${text.trimEnd()}\n\n${issueMenu(existing)}`
}

export type IssueCommand = 'issue' | 'append' | 'new' | 'chat' | 'later'
/** `/issue` always works; bare 1/2/3 are menu choices and are interpreted only by the Feishu receive hook. */
export function parseIssueCommand(text: string): IssueCommand | undefined {
  const clean = text.replace(/^(\s*@\S+)+\s*/, '').trim()
  if (/^\/issue(?:\s|$)/i.test(clean)) return 'issue'
  if (clean === '1') return 'append'
  if (clean === '2') return 'new'
  if (clean === '3') return 'chat'
  return undefined
}

/** Removes tokens, passwords, and obvious secrets before text is copied into a GitHub Issue. */
export function sanitizeIssueText(text: string): string {
  return text
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[已隐藏 Token]')
    .replace(/((?:token|password|passwd|secret|api[_-]?key|私钥)\s*[:=：]\s*)\S+/gi, '$1[已隐藏]')
    .replace(/(-----BEGIN [^-]+-----)[\s\S]+?(-----END [^-]+-----)/g, '$1 [已隐藏] $2')
}

export interface IssueDraftInput {
  request: string
  topicUrl?: string
  requester?: string
  plan?: string
  repository?: string
  platform?: string
  acceptance?: string
  sa?: boolean
}
export interface GithubIssueDraft { title: string; body: string; labels: string[]; assignees: string[] }
/** Builds the ledger Issue body mandated by the plan, including source link, target, acceptance, and SA origin. */
export function issueDraft(input: IssueDraftInput): GithubIssueDraft {
  const request = sanitizeIssueText(input.request.trim()) || '（未提供）'
  const titleLine = request.split('\n').find(line => line.trim())?.trim().slice(0, 80) || '飞书话题任务'
  const body = [
    '## 来源', `- 飞书话题：${input.topicUrl || '（未提供）'}`, `- 发起人：${input.requester || 'zhyfor'}`, '',
    '## 原始需求', request, '',
    '## 方案', sanitizeIssueText(input.plan || '（待补充）'), '',
    '## 目标仓库/平台', `- 仓库：${input.repository || '（待确认）'}`, `- 平台：${input.platform || 'GitHub'}`, '',
    '## 验收', sanitizeIssueText(input.acceptance || '（待补充）'), '',
    '## 改动来源', `- 是否 SA 改动：${input.sa ? '是（由SA更改）' : '否'}`,
  ].join('\n')
  return { title: titleLine, body, labels: ['source:feishu', 'agent:sa'], assignees: ['zhyfor'] }
}

const ledger = (ctx: Pick<SourceContext, 'state'>, thread: string): GithubIssueLink | undefined =>
  ctx.state.get(KV.feishuIssue.links)?.[thread]
const saveLedger = (ctx: Pick<SourceContext, 'state'>, thread: string, issue: GithubIssueLink): void => {
  const links = { ...(ctx.state.get(KV.feishuIssue.links) ?? {}) }
  links[thread] = { ...issue, updatedAt: new Date().toISOString() }
  ctx.state.set(KV.feishuIssue.links, links)
}

/** Intercepts `/issue` and menu replies before normal assessment; returns true when the message was consumed. */
export async function handleFeishuIssue(ctx: SourceContext, trigger: Trigger): Promise<boolean> {
  if (!trigger.channel) return false
  const command = parseIssueCommand(trigger.text)
  if (!command) return false
  const thread = trigger.threads[0]?.id ?? `feishu:${String(trigger.meta.chatId ?? '')}`
  markIssueAsked(thread)
  const reply = (text: string): void => {
    ctx.notify({ id: key('feishu-issue', trigger.id, command, text.slice(0, 32)), channel: trigger.channel!, text, kind: 'reply' })
  }
  const existing = ledger(ctx, thread)
  if (!existing && command === 'new') {
    reply('已记录：本话题仅聊天，不再自动询问。需要建单时发送 /issue。')
    return true
  }
  if (command === 'chat' || command === 'later') {
    reply('已记录：本话题仅聊天，不再自动询问。需要建单时发送 /issue。')
    return true
  }
  try {
    if (existing && command !== 'new') {
      await appendGithubIssue(ctx, TASK_LEDGER, existing.number,
        `## 追加需求\n\n${sanitizeIssueText(trigger.text)}\n\n- 飞书话题：${trigger.url ?? '（未提供）'}\n- 由SA更改`)
      reply(`已追加到 Issue #${existing.number}：${existing.url}`)
      return true
    }
    const draft = issueDraft({ request: trigger.text, topicUrl: trigger.url, requester: trigger.actor?.id,
      repository: ctx.deployment.repository, platform: 'GitHub', sa: true })
    const created = await createGithubIssue(ctx, TASK_LEDGER, draft)
    saveLedger(ctx, thread, created)
    reply(`已创建 Issue #${created.number}：${created.url}`)
  } catch (error) {
    reply(`创建 Issue 失败：${error instanceof Error ? error.message : String(error)}`)
  }
  return true
}
