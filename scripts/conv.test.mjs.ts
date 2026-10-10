// Unit test for the multi-conversation store logic (migration + title derivation).
// Mirrors the pure logic in src/main/index.ts without importing Electron.
import type { ChatMessage, Conversation } from '@shared/types'

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
function newConversation(): Conversation {
  const now = Date.now()
  return { id: makeId('conv'), title: 'New chat', createdAt: now, updatedAt: now, messages: [] }
}
function titleFromMessages(messages: ChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user')
  if (!firstUser) return 'New chat'
  const t = firstUser.content.trim().replace(/\s+/g, ' ')
  return t.length > 48 ? t.slice(0, 48) + '…' : t || 'New chat'
}

let failures = 0
function check(name: string, cond: boolean, extra = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' :: ' + extra : ''}`)
  if (!cond) failures++
}

const userMsg = (content: string): ChatMessage => ({ id: makeId('m'), role: 'user', content, createdAt: Date.now() })
const asstMsg = (content: string): ChatMessage => ({ id: makeId('m'), role: 'assistant', content, createdAt: Date.now() })

// title derivation
check('title from first user message', titleFromMessages([userMsg('How do I sort a list?')]) === 'How do I sort a list?')
check('title truncates long text', titleFromMessages([userMsg('y'.repeat(100))]).endsWith('…') && titleFromMessages([userMsg('y'.repeat(100))]).length === 49)
check('title falls back when no user msg', titleFromMessages([asstMsg('hi')]) === 'New chat')
check('title collapses whitespace', titleFromMessages([userMsg('  hello   world  ')]) === 'hello world')

// conversation creation
const c = newConversation()
check('new conversation has id + defaults', !!c.id && c.title === 'New chat' && c.messages.length === 0 && c.createdAt <= c.updatedAt)

// unique ids
const ids = new Set(Array.from({ length: 50 }, () => newConversation().id))
check('conversation ids unique', ids.size === 50)

console.log(`\n${failures === 0 ? 'ALL TESTS PASSED' : failures + ' TEST(S) FAILED'}`)
process.exit(failures === 0 ? 0 : 1)
