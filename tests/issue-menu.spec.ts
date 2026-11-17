import { describe, expect, it, vi } from 'vitest'
import type { Trigger } from '../src/core/index.ts'
import type { SourceContext } from '../src/sources/host.ts'
import { appendIssueMenu, handleFeishuIssue, issueDraft, issueMenu, parseIssueCommand, resetIssueMenuState, sanitizeIssueText }
  from '../src/sources/feishu-issue.ts'

const trigger = (text: string, id = 'om_test'): Trigger => ({
  id, source: 'feishu', threads: [{ source: 'feishu', id: 'feishu:oc_1:om_root' }],
  actor: { source: 'feishu', id: 'ou_user' }, human: true, at: new Date().toISOString(), text,
  url: 'https://applink.feishu.cn/client/chat/open?openChatId=oc_1',
  channel: { source: 'feishu', thread: 'feishu:oc_1:om_root', address: { chatId: 'oc_1', messageId: id } }, meta: { chatId: 'oc_1' },
})
const fake = () => {
  const store = new Map<string, unknown>()
  const gh = vi.fn(async (args: string[]) => args.includes('comments')
    ? {}
    : { number: 42, html_url: 'https://github.com/zhyfor/dshSuperagentRepo/issues/42', title: '任务' })
  const ctx = {
    state: { get: (key: string) => store.get(key), set: (key: string, value: unknown) => { store.set(key, value) } },
    commands: { gh, lark: vi.fn() }, notify: vi.fn(), deployment: { repository: 'zhyfor/dsh-superagent-prototype' },
  } as unknown as SourceContext
  return { ctx, gh }
}

describe('Feishu issue menu', () => {
  it('uses distinct menus for a new and an existing issue', () => {
    expect(issueMenu()).toContain('1. 转 Issue')
    expect(issueMenu({ number: 7 })).toContain('1. 追加到 #7')
    expect(appendIssueMenu('已完成', { number: 7 })).toContain('2. 新建 Issue')
    expect(appendIssueMenu('已完成\n\n是否将此话题转为 GitHub Issue？', { number: 7 })).toBe('已完成\n\n是否将此话题转为 GitHub Issue？')
  })
  it('parses /issue and menu choices', () => {
    expect(parseIssueCommand('/issue')).toBe('issue')
    expect(parseIssueCommand('@SA /issue')).toBe('issue')
    expect(parseIssueCommand('1')).toBe('append')
    expect(parseIssueCommand('2')).toBe('new')
    expect(parseIssueCommand('3')).toBe('chat')
    expect(parseIssueCommand('普通聊天')).toBeUndefined()
  })
  it('strips secrets and builds the ledger body', () => {
    expect(sanitizeIssueText('token=ghp_abcdefghijklmnopqrstuvwxyz123456')).toContain('[已隐藏]')
    const draft = issueDraft({ request: '修复 CI', topicUrl: 'https://feishu/x', repository: 'zhyfor/doc', sa: true })
    expect(draft.labels).toEqual(['source:feishu', 'agent:sa'])
    expect(draft.assignees).toEqual(['zhyfor'])
    expect(draft.body).toContain('由SA更改')
    expect(draft.body).toContain('zhyfor/doc')
  })
  it('creates once and appends to the same topic afterwards', async () => {
    resetIssueMenuState()
    const { ctx, gh } = fake()
    expect(await handleFeishuIssue(ctx, trigger('/issue', 'om_1'))).toBe(true)
    expect(gh).toHaveBeenCalledTimes(1)
    expect(String(gh.mock.calls[0]![0])).toContain('repos/zhyfor/dshSuperagentRepo/issues')
    expect(await handleFeishuIssue(ctx, trigger('/issue', 'om_2'))).toBe(true)
    expect(gh).toHaveBeenCalledTimes(2)
    expect(String(gh.mock.calls[1]![0])).toContain('/issues/42/comments')
    expect((ctx.notify as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0].text).toContain('已追加到 Issue #42')
  })
  it('reports permission failures without throwing', async () => {
    resetIssueMenuState()
    const { ctx, gh } = fake()
    gh.mockRejectedValueOnce(new Error('HTTP 403 permission denied'))
    await handleFeishuIssue(ctx, trigger('/issue', 'om_3'))
    expect((ctx.notify as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0].text).toContain('创建 Issue 失败')
  })
})
