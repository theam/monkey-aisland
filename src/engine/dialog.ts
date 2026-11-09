/**
 * Conversation runner: walks a dialogue tree loaded from YAML, feeds lines to
 * whoever is speaking, and offers the player their options in the bottom panel.
 *
 * A "cutscene" is just a tree whose nodes have no choices, so we don't need a
 * second system for the bit where three engineers mock you in sequence.
 */
import type { DialogAction, DialogChoice, DialogNode, DialogTree } from './content'
import { normaliseLines, type DialogLine } from './content'
import type { GameState } from './state'
import { now as clockNow } from './clock'

export type DialogHost = {
  state: GameState
  /** make `who` speak; the host handles colour, wrapping and timing */
  say: (who: string, text: string, hold?: number) => void
  isSpeaking: () => boolean
  hushAll: () => void
  emote: (who: string, emote?: string) => void
  action: (a: DialogAction) => void
  sfx: (id: string) => void
  /** turn `who` towards the player before they speak */
  face: (who: string) => void
}

export type ChoiceOption = { index: number; text: string; used: boolean }

/**
 * Index used for the synthetic "leave the conversation" option that is offered
 * on every decision, so a player can always get out of a tree.
 */
export const LEAVE_INDEX = -1

export class DialogRunner {
  private host: DialogHost
  /** label for the always-present way out, from ui.yaml `labels.leave` */
  leaveLabel = 'Actually, I should go.'
  private tree: DialogTree | null = null
  /** current node — readable so the UI can name it in warnings */
  nodeId = ''
  private queue: DialogLine[] = []
  private waiting = false
  private lineStartedAt = 0
  page = 0
  done = true
  /** set while the player's own chosen line is being spoken */
  private pendingAfterSay: (() => void) | null = null

  constructor(host: DialogHost) {
    this.host = host
  }

  get active(): boolean {
    return !this.done
  }

  get speaker(): string {
    return this.tree?.speaker ?? ''
  }

  get treeId(): string {
    return this.tree?.id ?? ''
  }

  start(tree: DialogTree): void {
    this.tree = tree
    this.done = false
    this.page = 0
    this.queue = []
    this.waiting = false
    this.pendingAfterSay = null
    this.enter(tree.start)
  }

  stop(): void {
    this.done = true
    this.tree = null
    this.queue = []
    this.waiting = false
    this.pendingAfterSay = null
    this.host.hushAll()
  }

  private node(): DialogNode | null {
    if (!this.tree) return null
    return this.tree.nodes[this.nodeId] ?? null
  }

  private enter(id: string): void {
    if (!this.tree) return
    const node = this.tree.nodes[id]
    if (!node) {
      // Content validation should have caught this; fail loudly in dev.
      console.error(`dialog ${this.tree.id}: missing node "${id}"`)
      this.stop()
      return
    }
    this.nodeId = id
    this.host.state.set(node.set)
    this.host.state.clear(node.clear)
    this.queue = normaliseLines(node.lines, this.tree.speaker)
    this.waiting = false
    this.page = 0
    if (node.action) this.host.action(node.action)
  }

  /** Options currently visible (respecting if/unless/once). */
  options(): ChoiceOption[] {
    const node = this.node()
    if (!node?.choices || this.queue.length > 0 || this.waiting) return []
    const out: ChoiceOption[] = []
    node.choices.forEach((c, i) => {
      if (!this.host.state.test(c)) return
      const used = this.isUsed(i)
      if (c.once && used) return
      out.push({ index: i, text: c.text, used })
    })
    return out
  }

  private usedKey(i: number): string {
    return `__said:${this.tree?.id}/${this.nodeId}/${i}`
  }

  private isUsed(i: number): boolean {
    return this.host.state.has(this.usedKey(i))
  }

  /**
   * The always-available exit. Authors don't have to remember to add one to
   * every node, which means they can't forget and trap the player.
   */
  leaveOption(): ChoiceOption | null {
    const node = this.node()
    if (!node?.choices || this.queue.length > 0 || this.waiting) return null
    // If the author already wrote a way out, don't add a second one — including
    // one that goes through a node whose job is to say goodbye and exit.
    const hasExit = node.choices.some((c) => {
      if (!this.host.state.test(c)) return false
      if (c.exit === true || c.action?.type === 'exit') return true
      const target = c.goto ? this.tree?.nodes[c.goto] : null
      return target?.action?.type === 'exit'
    })
    if (hasExit) return null
    return { index: LEAVE_INDEX, text: this.leaveLabel, used: false }
  }

  choose(index: number): void {
    if (index === LEAVE_INDEX) {
      this.stop()
      return
    }
    const node = this.node()
    if (!node?.choices) return
    const choice = node.choices[index]
    if (!choice) return
    this.host.state.set([this.usedKey(index)])

    const after = () => this.resolveChoice(choice)

    if (choice.say === false) {
      after()
      return
    }
    const text = typeof choice.say === 'string' ? choice.say : choice.text
    this.host.face(this.tree?.speaker ?? '')
    this.host.say('player', text)
    this.waiting = true
    this.pendingAfterSay = after
  }

  private resolveChoice(choice: DialogChoice): void {
    this.host.state.set(choice.set)
    this.host.state.clear(choice.clear)
    if (choice.action) this.host.action(choice.action)
    if (choice.exit) {
      this.stop()
      return
    }
    if (choice.goto) {
      this.enter(choice.goto)
      this.pump()
      return
    }
    // No goto: fall back to re-showing the current node's options.
    this.waiting = false
    this.pendingAfterSay = null
  }

  update(now: number): void {
    if (this.done) return
    if (this.host.isSpeaking()) return

    if (this.waiting) {
      this.waiting = false
      const cb = this.pendingAfterSay
      this.pendingAfterSay = null
      if (cb) {
        cb()
        return
      }
    }
    this.pump(now)
  }

  private pump(now = clockNow()): void {
    if (this.done) return
    if (this.queue.length > 0) {
      const line = this.queue.shift()!
      const who = line.who ?? this.tree?.speaker ?? 'narrator'
      if (line.sfx) this.host.sfx(line.sfx)
      this.host.emote(who, line.emote)
      this.host.face(who)
      this.host.say(who, line.text, line.hold)
      this.lineStartedAt = now
      return
    }

    const node = this.node()
    if (!node) {
      this.stop()
      return
    }
    if (node.choices && this.options().length > 0) return // wait for the player
    for (const b of node.branch ?? []) {
      if (!this.host.state.test(b)) continue
      this.enter(b.goto)
      this.pump(now)
      return
    }
    if (node.goto) {
      this.enter(node.goto)
      this.pump(now)
      return
    }
    // Nothing left to say and nowhere to go: conversation over.
    this.stop()
  }

  /** True while an NPC/player line is on screen (so the panel stays hidden). */
  get busy(): boolean {
    return this.queue.length > 0 || this.waiting || this.host.isSpeaking()
  }

  get lineAge(): number {
    return clockNow() - this.lineStartedAt
  }
}
