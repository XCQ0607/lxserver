import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'

const CARDS_FILE = 'cards.json'

interface Card {
  id: string
  code: string
  status: 'unused' | 'used'
  createdAt: number
  usedAt: number | null
  boundUser: string | null
  remark: string | null
  expireDays: number | null
}

let cards: Card[] = []

const cardsPath = () => path.join(global.lx.dataPath, CARDS_FILE)

const loadCards = (): void => {
  const p = cardsPath()
  if (fs.existsSync(p)) {
    try {
      cards = JSON.parse(fs.readFileSync(p, 'utf8'))
      if (!Array.isArray(cards)) cards = []
    } catch (e) {
      cards = []
    }
  }
}

const saveCards = (): void => {
  try {
    fs.writeFileSync(cardsPath(), JSON.stringify(cards, null, 2), 'utf8')
  } catch (e) {
    console.error('[Cards] Failed to save cards:', e)
  }
}

const generateCode = (): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  const bytes = crypto.randomBytes(16)
  for (let i = 0; i < 16; i++) {
    code += alphabet[bytes[i] % alphabet.length]
    if (i % 4 === 3 && i < 15) code += '-'
  }
  return code
}

/**
 * 批量生成卡密
 */
export const generateCards = (count: number, expireDays: number | null, remark: string | null): Card[] => {
  loadCards()
  const now = Date.now()
  const newCards: Card[] = []
  for (let i = 0; i < count; i++) {
    newCards.push({
      id: crypto.randomBytes(8).toString('hex'),
      code: generateCode(),
      status: 'unused',
      createdAt: now,
      usedAt: null,
      boundUser: null,
      remark: remark || null,
      expireDays: expireDays && expireDays > 0 ? expireDays : null,
    })
  }
  cards = [...cards, ...newCards]
  saveCards()
  return newCards
}

export const listCards = (): Card[] => {
  loadCards()
  return cards.slice().sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * 删除卡密（支持批量）
 */
export const deleteCards = (ids: string[]): number => {
  loadCards()
  const before = cards.length
  cards = cards.filter(c => !ids.includes(c.id))
  saveCards()
  return before - cards.length
}

/**
 * 校验并占用一张卡密
 * @returns 占用成功返回 true，失败抛出错误
 */
export const consumeCard = (code: string, boundUser: string): boolean => {
  loadCards()
  const normalized = code.trim().toUpperCase()
  const card = cards.find(c => c.code === normalized)
  if (!card) throw new Error('卡密不存在')
  if (card.status === 'used') throw new Error('卡密已被使用')
  if (card.expireDays) {
    const expireAt = card.createdAt + card.expireDays * 24 * 60 * 60 * 1000
    if (Date.now() > expireAt) throw new Error('卡密已过期')
  }
  card.status = 'used'
  card.usedAt = Date.now()
  card.boundUser = boundUser
  saveCards()
  return true
}

export const initCards = (): void => {
  loadCards()
}
