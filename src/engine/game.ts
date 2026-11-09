/**
 * The game: SCUMM-style verb/sentence interaction, scene management, walking,
 * conversations, and the last screen, which hands the player over to the
 * hiring chat in a new tab.
 */
import { Actor, drawSpeech, lineDuration, setPacing, type Facing } from './actor'
import type {
  Content, DialogAction, Hotspot, SceneActor, SceneExit, VerbResponse, Vec2,
} from './content'
import { isVerbResponseObject, normaliseLines } from './content'
import { Display, ROOM_H, SCREEN_H, SCREEN_W } from './display'
import { Framebuffer } from './framebuffer'
import { DialogRunner, type DialogHost } from './dialog'
import { clampToPoly, rectContains, rectCenter } from './geom'
import { C, colorByName } from './palette'
import { Room, type ScenePainter } from './room'
import { GameState, loadPrefs, savePrefs, type InventoryItem, type Prefs } from './state'
import type { Sprite } from './sprite'
import { nullSound, type SoundSystem } from './sound'
import { nullAnalytics, type Analytics } from './analytics'
import { chatLink, type Campaign } from './campaign'
import { hideOverlay, isOverlayOpen, showInterstitial } from './overlay'
import {
  CHOICE_MAX, drawChoiceRows, drawCursor, drawInventory, drawPanelBackground, drawSentence,
  drawSoundButton, drawVerbs, hitTestChoiceRow, hitTestPanel,
} from './ui'
import {
  CELL_H, balanceWrap, drawText, drawTextCentered, drawTextScaledCentered,
} from './font'
import { now as clockNow } from './clock'
import { animateTitle, paintTitle } from '../art/scenes/title'
import { paintStart } from '../art/scenes/start'

type Target =
  | { kind: 'actor'; actor: Actor; def: SceneActor; name: string; at: Vec2 }
  | { kind: 'hotspot'; def: Hotspot; name: string; at: Vec2 }
  | { kind: 'exit'; def: SceneExit; name: string; at: Vec2 }
  | { kind: 'item'; item: InventoryItem; name: string }

type Mode = 'start' | 'title' | 'play' | 'dialog' | 'cutscene' | 'overlay'

type QueuedLine = { who: string; text: string; hold?: number; sfx?: string; emote?: string }

const FADE_MS = 260

/** Keys that move focus around the page rather than meaning "start". */
export const NOT_START_KEYS = new Set(['tab', 'shift', 'control', 'alt', 'meta'])

export class Game {
  readonly state = new GameState()
  readonly display: Display
  private content: Content
  private sprites: Map<string, Sprite>
  private painters: Map<string, ScenePainter>
  private sound: SoundSystem = nullSound
  private analytics: Analytics = nullAnalytics
  /** False until PRESS START; nothing about the island is reported before it. */
  private playStarted = false
  /** The start scene, entered at load and held back until play begins. */
  private unreportedScene: string | null = null
  /** Called once, when the start screen gives way to the game. */
  onPlayStarted: (() => void) | null = null
  /**
   * The campaign tags the player arrived with, passed on to the hiring chat.
   * Whether or not this visit is counted: they are the ad's, not the player's,
   * and the chat would read the same tags had the ad linked to it directly.
   */
  campaign: Campaign = {}

  private rooms = new Map<string, Room>()
  private room!: Room
  private player!: Actor
  private actors = new Map<string, Actor>()
  private camX = 0

  private mode: Mode = 'start'
  /** null outside the intro; set when the intro starts rolling */
  private introStartedAt: number | null = null
  private titleFb: Framebuffer | null = null
  private startFb: Framebuffer | null = null
  private verb: string
  private firstObject: InventoryItem | null = null
  private hover: Target | null = null
  private invPage = 0
  private hoveredChoice = -1
  /** node ids we have already complained about overflowing the option list */
  private warnedOverflow = new Set<string>()
  private keyboardTargetIndex = -1

  private speech: QueuedLine[] = []
  private dialog: DialogRunner
  private prefs: Prefs
  private fadeUntil = 0
  private fadeFrom = 0
  private pendingScene: { to: string; entry?: string } | null = null
  private walkThenRun: (() => void) | null = null
  private lastSfxAt = new Map<string, number>()
  /** Room clicks are ignored until this time — see the cutscene skip guard. */
  private swallowClicksUntil = 0

  constructor(
    display: Display,
    content: Content,
    sprites: Map<string, Sprite>,
    painters: Map<string, ScenePainter>,
  ) {
    this.display = display
    this.content = content
    this.sprites = sprites
    this.painters = painters
    this.verb = content.ui.default_verb || 'walk'
    this.prefs = loadPrefs({
      music: content.config.audio?.music ?? true,
      sfx: content.config.audio?.sfx ?? true,
      volume: content.config.audio?.volume ?? 0.7,
    })

    const host: DialogHost = {
      state: this.state,
      say: (who, text, hold) => this.speak(who, text, hold),
      isSpeaking: () => this.someoneSpeaking(),
      hushAll: () => this.hushAll(),
      emote: (who, emote) => this.actors.get(who)?.setEmote(emote ?? null),
      action: (a) => this.performAction(a),
      sfx: (id) => this.playSfx(id),
      face: (who) => this.faceSpeaker(who),
    }
    this.dialog = new DialogRunner(host)
    this.dialog.leaveLabel = content.ui.labels?.leave ?? 'Actually, I should go.'
    setPacing(content.ui.pacing)
  }

  attachSound(sound: SoundSystem): void {
    this.sound = sound
    this.sound.setMusicEnabled(this.prefs.music)
    this.sound.setSfxEnabled(this.prefs.sfx)
    this.sound.setVolume(this.prefs.volume)
    if (this.room) this.sound.music(this.room.def.music ?? null)
  }

  attachAnalytics(analytics: Analytics): void {
    this.analytics = analytics
    // Winning the duel is the one content flag that counts as a funnel step.
    // Content sets a couple of dozen others — `__said:` keys, running jokes,
    // whether you spelled Chaxiraxi right — and they are all bookkeeping.
    const milestones = new Set(['won_duel'])
    this.state.onFirstSet = (flag) => {
      if (milestones.has(flag)) this.analytics.trackOnce(flag)
    }
  }

  /**
   * The first arrival in each room is a funnel step: `reached_lookout`,
   * `reached_dock`, `reached_bar`. Named after the scene, so a fourth room
   * joins the funnel with no analytics code to touch. Walking back somewhere
   * is not counted — where people give up is the question, not how they
   * wander, and the step timings (`at`) already show where the middle drags.
   */
  private reportScene(id: string): void {
    this.analytics.trackOnce(`reached_${id}`)
  }

  /** PRESS START, or `?skipintro`. Releases the scene held back at load. */
  private markPlayStarted(): void {
    if (this.playStarted) return
    this.playStarted = true
    this.analytics.trackOnce('game_started')
    const held = this.unreportedScene
    this.unreportedScene = null
    if (held) this.reportScene(held)
    this.onPlayStarted?.()
  }

  // -------------------------------------------------------------------------
  // Scenes
  // -------------------------------------------------------------------------

  private roomFor(id: string): Room {
    let room = this.rooms.get(id)
    if (!room) {
      const def = this.content.scenes.get(id)
      if (!def) throw new Error(`unknown scene "${id}"`)
      const painter = this.painters.get(def.background) ?? this.painters.get('__fallback')
      if (!painter) throw new Error(`no painter for background "${def.background}"`)
      room = new Room(def, painter)
      this.rooms.set(id, room)
    }
    return room
  }

  enterScene(id: string, entry?: string, at?: Vec2): void {
    const room = this.roomFor(id)
    this.room = room
    this.state.scene = id

    // Rebuild the actor cast for this room.
    const player = this.player ?? new Actor('player', this.sprite('player'), 0, 0)
    this.actors.clear()
    this.actors.set('player', player)
    this.player = player

    for (const a of room.def.actors ?? []) {
      if (!this.state.test(a)) continue
      const sprite = this.sprite(a.sprite ?? a.id)
      const actor = new Actor(a.id, sprite, a.at[0], a.at[1], a.facing === 'left' ? -1 : 1)
      this.actors.set(a.id, actor)
    }

    const spawn = at
      ? { at, facing: undefined as 'left' | 'right' | undefined }
      : (entry && room.def.entries?.[entry]) || room.def.player_start
    const facing: Facing = spawn.facing === 'left' ? -1 : 1
    player.place(spawn.at[0], spawn.at[1], facing)
    player.sprite = this.sprite('player')

    this.camX = this.clampCam(player.x - SCREEN_W / 2)
    this.firstObject = null
    this.invPage = 0
    this.hover = null
    this.keyboardTargetIndex = -1
    this.sound.music(room.def.music ?? null)

    const firstVisit = !this.state.visited.has(id)
    this.state.visited.add(id)
    // The start scene is built and painted behind the title card, so reporting
    // it here would count everyone who loaded the page as having reached the
    // island. Hold it until they actually press START.
    if (this.playStarted) this.reportScene(id)
    else this.unreportedScene = id

    for (const ev of room.def.on_enter ?? []) {
      if (ev.once && !firstVisit) continue
      if (!this.state.test({ if: ev.if })) continue
      this.queueLines(normaliseLines(ev.lines, 'narrator'))
    }
  }

  private clampCam(x: number): number {
    return Math.max(0, Math.min(this.room.maxCamX(), Math.round(x)))
  }

  private sprite(id: string): Sprite {
    const s = this.sprites.get(id)
    if (!s) {
      const fallback = this.sprites.get('player')
      if (!fallback) throw new Error(`missing sprite "${id}" and no fallback`)
      console.warn(`missing sprite "${id}", using player sprite`)
      return fallback
    }
    return s
  }

  // -------------------------------------------------------------------------
  // Speech
  // -------------------------------------------------------------------------

  private colorFor(who: string): number {
    const key = who === 'player' ? 'sayPlayer' : `say${who.charAt(0).toUpperCase()}${who.slice(1)}`
    const spec = this.content.speakers.get(who)
    if (spec?.color) return colorByName(spec.color, C.sayNarrator)
    return colorByName(key, C.sayNarrator)
  }

  private speak(who: string, text: string, hold?: number): void {
    const actor = this.actors.get(who)
    const color = this.colorFor(who)
    if (actor) {
      actor.say(text, color, clockNow(), hold ?? 1)
    } else {
      // Narrator / off-screen voice: centred near the top of the room. Same
      // pacing as everyone else, so cutscenes move along on their own too.
      this.narrator = { text, color, endsAt: clockNow() + lineDuration(text, hold ?? 1) }
    }
  }

  private narrator: { text: string; color: number; endsAt: number } | null = null

  private someoneSpeaking(): boolean {
    if (this.narrator) return true
    for (const a of this.actors.values()) if (a.speaking) return true
    return false
  }

  private hushAll(): void {
    this.narrator = null
    for (const a of this.actors.values()) a.hush()
  }

  private queueLines(lines: { who?: string; text: string; hold?: number; sfx?: string; emote?: string }[]): void {
    for (const l of lines) this.speech.push({ who: l.who ?? 'narrator', text: l.text, hold: l.hold, sfx: l.sfx, emote: l.emote })
    if (this.speech.length && this.mode === 'play') this.mode = 'cutscene'
  }

  private faceSpeaker(who: string): void {
    const a = this.actors.get(who)
    if (!a) return
    if (who === 'player') {
      // face whoever we're talking to
      const other = this.dialog.speaker && this.actors.get(this.dialog.speaker)
      if (other) a.faceTowards(other.x)
    } else {
      a.faceTowards(this.player.x)
    }
  }

  private playSfx(id: string): void {
    if (!id) return
    const now = clockNow()
    const last = this.lastSfxAt.get(id) ?? 0
    if (now - last < 60) return
    this.lastSfxAt.set(id, now)
    this.sound.sfx(id)
  }

  // -------------------------------------------------------------------------
  // Verbs & targets
  // -------------------------------------------------------------------------

  private verbDef(id: string) {
    return this.content.ui.verbs.find((v) => v.id === id)
  }

  private targetsInRoom(): Target[] {
    const out: Target[] = []
    for (const a of this.room.def.actors ?? []) {
      const actor = this.actors.get(a.id)
      if (!actor || !this.state.test(a)) continue
      out.push({ kind: 'actor', actor, def: a, name: a.name ?? a.id, at: [actor.x, actor.y] })
    }
    for (const h of this.room.def.hotspots ?? []) {
      if (!this.state.test(h)) continue
      out.push({ kind: 'hotspot', def: h, name: h.name, at: rectCenter(h.rect) })
    }
    for (const e of this.room.def.exits ?? []) {
      // Gated exits disappear, unless they have something to say about it.
      if (!this.state.test(e) && !e.blocked) continue
      out.push({ kind: 'exit', def: e, name: e.name, at: rectCenter(e.rect) })
    }
    return out
  }

  private targetAt(sx: number, sy: number): Target | null {
    if (sy >= ROOM_H) return null
    const x = sx + this.camX
    const y = sy

    // Actors first: they're the interesting ones.
    let best: Target | null = null
    let bestArea = Infinity
    for (const t of this.targetsInRoom()) {
      if (t.kind === 'actor') {
        const a = t.actor
        const w = a.sprite.w * a.scale
        const h = a.sprite.h * a.scale
        const r: [number, number, number, number] = [a.x - w / 2 - 2, a.y - h - 2, w + 4, h + 4]
        if (rectContains(r, x, y)) return t
      }
    }
    for (const t of this.targetsInRoom()) {
      if (t.kind === 'actor' || t.kind === 'item') continue
      const r = t.def.rect
      if (rectContains(r, x, y)) {
        const area = r[2] * r[3]
        // smaller hotspots win, so a doorknob beats the whole door
        if (area < bestArea) {
          bestArea = area
          best = t
        }
      }
    }
    return best
  }

  private buildSentence(): string {
    const s = this.content.ui.sentence
    const v = this.verbDef(this.verb)
    const verbLabel = v?.label ?? s.walk_to

    if (this.firstObject) {
      const prep = v?.prep ?? s.with
      const second = this.hover ? this.hover.name : '...'
      return `${verbLabel} ${this.firstObject.name} ${prep} ${second}`
    }
    if (this.hover) return `${verbLabel} ${this.hover.name}`
    if (this.verb === 'walk') return s.walk_to
    return verbLabel
  }

  // -------------------------------------------------------------------------
  // Interaction
  // -------------------------------------------------------------------------

  private onRoomClick(sx: number, sy: number): void {
    const target = this.targetAt(sx, sy)
    const x = sx + this.camX

    if (!target) {
      // Walking on the floor cancels a pending two-object sentence.
      this.firstObject = null
      const [wx, wy] = clampToPoly(x, sy, this.room.walkbox)
      this.player.walkTo(wx, wy, this.room.walkbox)
      this.playSfx('step')
      return
    }

    if (this.firstObject) {
      this.interact(this.verb, target, this.firstObject)
      this.firstObject = null
      return
    }

    if (this.verb === 'walk') {
      if (target.kind === 'exit') this.useExit(target.def)
      else if (target.kind === 'actor') {
        this.approach(target, () => this.talkTo(target))
      } else if (target.kind === 'hotspot') {
        const wt = target.def.walk_to
        if (wt) this.player.walkTo(wt[0], wt[1], this.room.walkbox)
        else {
          const [wx, wy] = clampToPoly(target.at[0], Math.max(sy, target.at[1]), this.room.walkbox)
          this.player.walkTo(wx, wy, this.room.walkbox)
        }
      }
      return
    }

    this.interact(this.verb, target)
  }

  private onInventoryClick(item: InventoryItem): void {
    const v = this.verbDef(this.verb)
    // Two-object verbs (Use / Give) take the inventory item as the first object.
    if (v?.prep) {
      this.firstObject = item
      return
    }
    this.interact(this.verb, { kind: 'item', item, name: item.name })
  }

  private approach(target: Target, then: () => void): void {
    const walkTo = this.walkTargetFor(target)
    if (!walkTo) {
      then()
      return
    }
    const dist = Math.hypot(this.player.x - walkTo[0], this.player.y - walkTo[1])
    if (dist < 6) {
      then()
      return
    }
    this.walkThenRun = then
    this.player.walkTo(walkTo[0], walkTo[1], this.room.walkbox, () => {
      const cb = this.walkThenRun
      this.walkThenRun = null
      if (target.kind !== 'item') this.player.faceTowards(target.at[0])
      cb?.()
    })
  }

  private walkTargetFor(target: Target): Vec2 | null {
    if (target.kind === 'item') return null
    if (target.kind === 'actor') {
      const side = this.player.x < target.actor.x ? -1 : 1
      const gap = 22 * Math.max(0.6, target.actor.scale)
      return clampToPoly(target.actor.x + side * gap, target.actor.y, this.room.walkbox)
    }
    const wt = target.def.walk_to
    if (wt) return [wt[0], wt[1]]
    return null
  }

  private interact(verb: string, target: Target, using?: InventoryItem): void {
    if (target.kind === 'exit' && (verb === 'walk' || verb === 'enter')) {
      this.useExit(target.def)
      return
    }
    if (verb === 'talk' && target.kind === 'actor') {
      this.approach(target, () => this.talkTo(target))
      return
    }

    const bag = this.verbsOf(target)
    const keys = using ? [`${verb}:${using.id}`, `${verb}_any`] : [verb]
    let response: VerbResponse | undefined
    for (const k of keys) {
      const r = bag?.[k]
      // `null` in YAML means "explicitly nothing here" — fall through to defaults.
      if (r !== undefined && r !== null && this.responseAllowed(r)) {
        response = r
        break
      }
    }

    const run = () => {
      // The sentence resets to the default verb once the command runs, exactly
      // like the original. Without this you can select "Look at" and never get
      // back to walking, which locks the player out of the exits.
      this.resetVerb()
      if (response !== undefined) this.runResponse(response, target, using)
      else this.runDefault(verb, target, using)
    }

    // Only walk when the author asked for it (or we're talking to somebody).
    if (target.kind === 'hotspot' && target.def.walk_to) this.approach(target, run)
    else if (target.kind === 'actor') this.approach(target, run)
    else run()
  }

  /**
   * The dialogue options, with the always-available way out last — so there is
   * never a conversation you can't get out of.
   *
   * Hard limit of CHOICE_MAX rows and no paging, deliberately: scrolling a menu
   * is not how the original talked. Content is written to fit; if a node ever
   * overflows, the extra options are dropped and a warning is logged rather
   * than silently paginating the conversation into something clunky.
   */
  private choiceRows(): { rows: { text: string; used: boolean; index: number }[] } {
    const opts = this.dialog.options()
    const leave = this.dialog.leaveOption()
    const room = leave ? CHOICE_MAX - 1 : CHOICE_MAX

    if (opts.length > room && !this.warnedOverflow.has(this.dialog.nodeId)) {
      this.warnedOverflow.add(this.dialog.nodeId)
      console.warn(
        `dialogue ${this.dialog.treeId}/${this.dialog.nodeId} offers ${opts.length} options; ` +
          `only ${room} fit. Split the node or gate some choices with if/once.`,
      )
    }

    const rows = opts.slice(0, room).map((o, i) => ({
      text: `${i + 1}. ${o.text}`,
      used: o.used,
      index: o.index,
    }))
    if (leave) {
      rows.push({ text: `${rows.length + 1}. ${leave.text}`, used: false, index: leave.index })
    }
    return { rows }
  }

  /** Back to "Walk to", cancelling any half-built two-object sentence. */
  private resetVerb(): void {
    this.verb = this.content.ui.default_verb || 'walk'
    this.firstObject = null
  }

  private verbsOf(target: Target): Record<string, VerbResponse> | undefined {
    if (target.kind === 'hotspot') return target.def.verbs
    if (target.kind === 'actor') return target.def.verbs
    if (target.kind === 'exit') return undefined
    return undefined
  }

  private responseAllowed(r: VerbResponse): boolean {
    if (!isVerbResponseObject(r)) return true
    return this.state.test(r)
  }

  private runResponse(r: VerbResponse, target: Target, using?: InventoryItem): void {
    if (typeof r === 'string') {
      this.queueLines([{ who: 'player', text: r }])
      return
    }
    if (Array.isArray(r)) {
      this.queueLines(r.map((t) => ({ who: 'player', text: t })))
      return
    }
    this.state.set(r.set)
    this.state.clear(r.clear)
    if (r.sfx) this.playSfx(r.sfx)
    if (r.say) {
      const lines = Array.isArray(r.say) ? r.say : [r.say]
      this.queueLines(lines.map((t) => ({ who: r.who ?? 'player', text: t })))
    }
    if (r.dialog) this.startDialog(r.dialog)
    if (r.action) this.performAction(r.action)
    if (!r.say && !r.dialog && !r.action) this.runDefault(this.verb, target, using)
  }

  private runDefault(verb: string, target: Target, using?: InventoryItem): void {
    const pools = this.content.ui.defaults
    const poolKey = using ? `${verb}_with` : verb
    const pool = pools[poolKey] ?? pools[verb] ?? pools.default ?? ['I have no idea what I am doing.']
    const line = this.state.cycle(`default:${poolKey}`, pool)
    const name = target.kind === 'item' ? target.item.name : target.name
    this.queueLines([{ who: 'player', text: line.replace(/%s/g, name).replace(/%i/g, using?.name ?? name) }])
  }

  private talkTo(target: Target): void {
    if (target.kind !== 'actor') return
    const treeId = target.def.dialog
    if (!treeId) {
      this.runDefault('talk', target)
      return
    }
    this.startDialog(treeId)
  }

  private startDialog(id: string): void {
    const tree = this.content.dialogs.get(id)
    if (!tree) {
      console.error(`unknown dialog "${id}"`)
      return
    }
    this.mode = 'dialog'
    this.hoveredChoice = -1
    this.player.cancelWalk()
    // Which conversations people open at all, once each per visit. What they
    // answer inside one is deliberately not counted: the duel's options are
    // attitudes ("It works, though."), and recording which one a visitor
    // picked would be measuring candidates, not the game.
    this.analytics.trackOnce('dialog_opened', { dialog: id }, `dialog_opened:${id}`)
    this.dialog.start(tree)
  }

  private useExit(exit: SceneExit): void {
    if (!this.state.test(exit)) {
      // A gated exit that defines `blocked` stays visible and explains itself
      // instead of quietly doing nothing.
      if (exit.blocked) {
        this.runResponse(exit.blocked, {
          kind: 'exit', def: exit, name: exit.name, at: rectCenter(exit.rect),
        })
      }
      return
    }
    const go = () => this.beginSceneChange(exit.to, exit.entry)
    if (exit.walk_to) {
      this.walkThenRun = go
      this.player.walkTo(exit.walk_to[0], exit.walk_to[1], this.room.walkbox, () => {
        const cb = this.walkThenRun
        this.walkThenRun = null
        cb?.()
      })
    } else go()
  }

  private beginSceneChange(to: string, entry?: string): void {
    this.pendingScene = { to, entry }
    this.fadeFrom = clockNow()
    this.fadeUntil = this.fadeFrom + FADE_MS * 2
    this.playSfx('whoosh')
  }

  private performAction(a: DialogAction): void {
    switch (a.type) {
      case 'exit':
        this.dialog.stop()
        this.mode = 'play'
        break
      case 'scene':
        this.dialog.stop()
        this.beginSceneChange(a.to, a.entry)
        break
      case 'give': {
        const name = this.content.ui.labels[`item_${a.item}`] ?? a.item
        this.state.give({ id: a.item, name })
        this.playSfx('pickup')
        break
      }
      case 'sfx':
        this.playSfx(a.id)
        break
      case 'music':
        this.sound.music(a.id)
        break
      case 'interstitial':
        this.showInterstitialById(a.id)
        break
      case 'chat':
        this.openHiringChat()
        break
      case 'dialog':
        // Hand off to another tree: shared scenes, the code-review duel, the
        // monkeys' challenge briefing.
        this.startDialog(a.id)
        break
    }
  }

  private showInterstitialById(id: string): void {
    const copy = this.content.ui.interstitials[id]
    if (!copy) {
      console.error(`unknown interstitial "${id}"`)
      return
    }
    this.dialog.stop()
    this.mode = 'overlay'
    if (id === 'to_the_chat') {
      // The last screen, and the gate: its button is a plain link to the
      // hiring chat. Everything before it is the game's funnel, everything
      // after is the chat's own, joined by the utm_ tags in the URL rather
      // than by anything we know about a person. The chat shows its own
      // privacy notice; the game collects nothing here.
      this.analytics.trackOnce('handoff_shown')
      showInterstitial(copy, () => this.chatOpened(), {
        href: chatLink(this.content.config.chat.url, this.campaign),
        onCancel: () => this.backToIsland(),
      })
      return
    }
    showInterstitial(copy, () => this.backToIsland())
  }

  /** The chat is open in its own tab. This one says there is no rush. */
  private chatOpened(): void {
    this.state.set(['chat_opened'])
    this.analytics.trackOnce('chat_opened')
    if (this.content.ui.interstitials.after_chat) this.showInterstitialById('after_chat')
    else this.backToIsland()
  }

  private backToIsland(): void {
    hideOverlay()
    this.mode = 'play'
  }

  private openHiringChat(): void {
    this.showInterstitialById('to_the_chat')
  }

  // -------------------------------------------------------------------------
  // Frame
  // -------------------------------------------------------------------------

  update(dt: number, now: number): void {
    const p = this.display.pointer
    const keys = this.display.keysPressed

    if (this.mode === 'start') {
      this.updateStart(now)
      return
    }
    if (this.mode === 'title') {
      this.updateTitle(now)
      return
    }

    if (keys.has('m')) this.toggleSound()

    // ---- scene transition -------------------------------------------------
    if (this.pendingScene && now >= this.fadeFrom + FADE_MS) {
      const { to, entry } = this.pendingScene
      this.pendingScene = null
      this.enterScene(to, entry)
    }

    // ---- speech queue (cutscenes, look-at responses) ----------------------
    if (this.narrator && now >= this.narrator.endsAt) this.narrator = null

    if (this.mode === 'cutscene' || (this.mode === 'play' && this.speech.length > 0)) {
      this.mode = this.speech.length > 0 || this.someoneSpeaking() ? 'cutscene' : 'play'
    }
    if (!this.someoneSpeaking() && this.speech.length > 0) {
      const line = this.speech.shift()!
      if (line.sfx) this.playSfx(line.sfx)
      if (line.emote) this.actors.get(line.who)?.setEmote(line.emote)
      this.speak(line.who, line.text, line.hold)
    }
    if (!this.someoneSpeaking() && this.speech.length === 0 && this.mode === 'cutscene') {
      this.mode = this.dialog.active ? 'dialog' : 'play'
    }

    // ---- dialogue ---------------------------------------------------------
    if (this.mode === 'dialog' || this.dialog.active) {
      this.dialog.update(now)
      if (!this.dialog.active && this.mode === 'dialog') {
        this.mode = 'play'
      }
    }

    // ---- input ------------------------------------------------------------
    if (this.mode !== 'overlay') this.handleInput(now)

    // ---- actors -----------------------------------------------------------
    const scaleAt = (y: number) => this.room.scaleAt(y)
    for (const a of this.actors.values()) a.update(dt, now, this.room.walkbox, scaleAt)

    // ---- camera -----------------------------------------------------------
    if (this.room.def.camera === 'follow') {
      const want = this.clampCam(this.player.x - SCREEN_W / 2)
      this.camX += (want - this.camX) * Math.min(1, dt * 6)
      if (Math.abs(want - this.camX) < 0.6) this.camX = want
    } else {
      this.camX = 0
    }

    // ---- hover ------------------------------------------------------------
    this.hover = p.over && this.mode === 'play' ? this.targetAt(p.x, p.y) : null
  }

  private handleInput(now: number): void {
    const p = this.display.pointer
    const keys = this.display.keysPressed
    const pressed = p.justPressed || keys.has(' ') || keys.has('escape')

    // During a cutscene a press means one thing only: skip this line. It must
    // never fall through to the room — otherwise the click on "(click to skip)"
    // also sends the player walking to wherever the prompt happened to be.
    if (this.mode === 'cutscene') {
      if (pressed) {
        if (this.someoneSpeaking()) this.hushAll()
        // The press that ends the last line also lands in the frames just after
        // the cutscene finishes, so hold the room off briefly.
        this.swallowClicksUntil = now + 260
      }
      return
    }

    // Same guard for the line currently being spoken inside a conversation.
    if (pressed && this.mode === 'dialog' && this.someoneSpeaking()) {
      this.hushAll()
      this.swallowClicksUntil = now + 200
      return
    }

    if (p.justPressed && now < this.swallowClicksUntil) return

    if (this.mode === 'dialog') {
      const rows = this.choiceRows().rows
      if (rows.length) {
        const choiceAtPointer = p.over || p.justPressed
          ? hitTestChoiceRow(p.x, p.y, rows.map((r) => r.text), this.display.usesTouchControls)
          : -1
        this.hoveredChoice = this.display.usesTouchControls ? -1 : choiceAtPointer
        for (let i = 0; i < rows.length; i++) {
          if (keys.has(String(i + 1))) this.dialog.choose(rows[i].index)
        }
        if (p.justPressed && choiceAtPointer >= 0) {
          this.dialog.choose(rows[choiceAtPointer].index)
        }
      }
      return
    }

    if (this.mode !== 'play') return

    // Escape always gets you back to plain walking.
    if (keys.has('escape')) this.resetVerb()

    // verb shortcuts
    for (const v of this.content.ui.verbs) {
      if (v.key && keys.has(v.key)) {
        this.verb = v.id
        this.firstObject = null
      }
    }

    // keyboard target cycling — makes the game playable without a mouse
    if (keys.has('tab')) {
      const targets = this.targetsInRoom()
      if (targets.length) {
        this.keyboardTargetIndex = (this.keyboardTargetIndex + 1) % targets.length
        this.hover = targets[this.keyboardTargetIndex]
      }
    }
    if ((keys.has('enter') || keys.has('return')) && this.hover) {
      const t = this.hover
      if (this.verb === 'walk' && t.kind === 'exit') this.useExit(t.def)
      else this.interact(this.verb, t, this.firstObject ?? undefined)
      this.firstObject = null
      return
    }

    if (p.rightJustPressed) {
      // Right click does the obvious thing for whatever is under it: talk to
      // people, look at everything else. It also clears a selected verb, so a
      // mis-click on the panel is never a trap.
      const t = this.targetAt(p.x, p.y)
      this.resetVerb()
      if (t) this.interact(t.kind === 'actor' ? 'talk' : 'look', t)
      return
    }

    if (!p.justPressed) return

    const panelHit = hitTestPanel(p.x, p.y, this.content.ui.verbs, this.state.inventory, this.invPage)
    if (panelHit) {
      switch (panelHit.kind) {
        case 'verb':
          this.verb = panelHit.id
          this.firstObject = null
          this.playSfx('click')
          break
        case 'item':
          this.onInventoryClick(panelHit.item)
          this.playSfx('click')
          break
        case 'invUp':
          this.invPage = Math.max(0, this.invPage - 1)
          break
        case 'invDown':
          this.invPage++
          break
        case 'sound':
          this.toggleSound()
          break
      }
      return
    }

    if (p.y < ROOM_H) {
      this.sound.unlock()
      if (p.doubleClick) {
        const t = this.targetAt(p.x, p.y)
        if (t?.kind === 'exit') {
          this.beginSceneChange(t.def.to, t.def.entry)
          return
        }
      }
      this.onRoomClick(p.x, p.y)
      void now
    }
  }

  private toggleSound(): void {
    this.prefs.music = !this.prefs.music
    this.prefs.sfx = this.prefs.music
    savePrefs(this.prefs)
    this.sound.setMusicEnabled(this.prefs.music)
    this.sound.setSfxEnabled(this.prefs.sfx)
    if (this.prefs.music) this.sound.music(this.room.def.music ?? null)
  }

  draw(now: number): void {
    const fb = this.display.fb

    if (this.mode === 'start' || this.mode === 'title') {
      if (this.mode === 'start') this.drawStart(now)
      else this.drawTitle(now)
      if (this.display.pointer.over && !this.display.pointer.touch) {
        drawCursor(fb, this.display.pointer.x, this.display.pointer.y, false)
      }
      return
    }

    const bg = this.room.render(now / 1000)

    // background slice
    const cam = Math.round(this.camX)
    for (let y = 0; y < ROOM_H; y++) {
      const srow = y * bg.w
      const trow = y * fb.w
      for (let x = 0; x < SCREEN_W; x++) {
        fb.px[trow + x] = bg.px[srow + Math.min(bg.w - 1, cam + x)]
      }
    }

    // actors, back to front
    const cast = [...this.actors.values()].sort((a, b) => a.y + a.zBias - (b.y + b.zBias))
    for (const a of cast) a.draw(fb, cam, now)

    // foreground layer: things that stand in front of the cast
    if (this.room.fg) {
      fb.blit(this.room.fg, 0, 0, { sx: cam, sy: 0, sw: SCREEN_W, sh: ROOM_H })
    }

    for (const a of cast) drawSpeech(fb, a, cam)

    if (this.narrator) {
      const lines = balanceWrap(this.narrator.text, 280)
      let y = 8
      for (const l of lines) {
        drawTextCentered(fb, l, SCREEN_W / 2, y, { color: this.narrator.color, outlineColor: C.black })
        y += 10
      }
    }

    // interface
    drawPanelBackground(fb)
    if (this.mode === 'dialog' && !this.dialog.busy) {
      drawChoiceRows(fb, this.choiceRows().rows, this.hoveredChoice, this.display.usesTouchControls)
    } else if (this.mode === 'play') {
      drawSentence(fb, this.buildSentence())
      drawVerbs(fb, this.content.ui.verbs, this.verb, this.hoveredVerb())
      drawInventory(fb, this.state.inventory, this.invPage, this.hoveredItem(), this.firstObject)
      drawSoundButton(fb, this.prefs.music, false)
    } else if (this.mode === 'cutscene') {
      drawTextCentered(fb, this.content.ui.labels.skip ?? '', SCREEN_W / 2, 190, { color: C.grey2 })
    }

    // fade to black on scene change
    if (now < this.fadeUntil) {
      const t = (now - this.fadeFrom) / (FADE_MS * 2)
      const a = t < 0.5 ? t * 2 : (1 - t) * 2
      this.fadeRect(fb, a)
    }

    if (this.display.pointer.over && this.mode !== 'overlay' && !this.display.pointer.touch) {
      drawCursor(fb, this.display.pointer.x, this.display.pointer.y, this.hover !== null)
    }

    if (this.content.config.debug) this.drawDebug(fb, cam)
  }

  private fadeRect(fb: import('./framebuffer').Framebuffer, amount: number): void {
    const step = Math.round(amount * 4)
    if (step <= 0) return
    for (let y = 0; y < ROOM_H; y++) {
      for (let x = 0; x < SCREEN_W; x++) {
        // ordered 4x4 dissolve to black — cheap, and very 1990
        const t = ((x & 3) + ((y & 3) << 2)) % 16
        if (t < step * 4) fb.set(x, y, C.black)
      }
    }
  }

  private hoveredVerb(): string | null {
    const p = this.display.pointer
    const hit = hitTestPanel(p.x, p.y, this.content.ui.verbs, this.state.inventory, this.invPage)
    return hit?.kind === 'verb' ? hit.id : null
  }

  private hoveredItem(): InventoryItem | null {
    const p = this.display.pointer
    const hit = hitTestPanel(p.x, p.y, this.content.ui.verbs, this.state.inventory, this.invPage)
    return hit?.kind === 'item' ? hit.item : null
  }

  private drawDebug(fb: import('./framebuffer').Framebuffer, cam: number): void {
    const poly = this.room.walkbox
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % poly.length]
      const steps = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1])))
      for (let s = 0; s <= steps; s++) {
        const x = a[0] + ((b[0] - a[0]) * s) / steps - cam
        const y = a[1] + ((b[1] - a[1]) * s) / steps
        if ((s & 1) === 0) fb.set(Math.round(x), Math.round(y), C.red3)
      }
    }
    for (const h of this.room.def.hotspots ?? []) {
      const [x, y, w, hh] = h.rect
      for (let i = 0; i < w; i += 2) {
        fb.set(x - cam + i, y, C.gold3)
        fb.set(x - cam + i, y + hh - 1, C.gold3)
      }
      for (let i = 0; i < hh; i += 2) {
        fb.set(x - cam, y + i, C.gold3)
        fb.set(x - cam + w - 1, y + i, C.gold3)
      }
    }
    drawText(fb, `${Math.round(this.player.x)},${Math.round(this.player.y)}`, 2, 2, { color: C.gold3, shadow: C.black })
  }

  /**
   * Boot. Nothing is persisted: every visit starts at the top of the path.
   *
   * The player sees the start screen first. The press that leaves it is the
   * browser's required audio gesture, so the music is already playing by the
   * time the title card appears — and the intro can then run on its own.
   */
  begin(): void {
    this.enterScene(this.content.config.start_scene)
    const ui = this.content.ui
    if (ui.start) {
      this.mode = 'start'
      this.startFb = paintStart(ui.start.wordmark)
    } else if (ui.title) {
      this.beginIntro(clockNow())
    } else {
      this.mode = 'play'
    }
  }

  /** Leave the start screen: music on, title card up, intro rolling. */
  private beginIntro(now: number): void {
    // PRESS START. The first act of will: everything before this is someone
    // who loaded a page, everything after is someone playing a game.
    this.markPlayStarted()
    this.sound.unlock()
    this.sound.music(this.room.def.music ?? null)
    if (!this.content.ui.title) {
      this.mode = 'play'
      return
    }
    if (!this.titleFb) this.titleFb = paintTitle()
    this.mode = 'title'
    this.introStartedAt = now
  }

  /** Skip straight to the game (used by `?skipintro` and by tests). */
  skipIntro(): void {
    if (this.mode !== 'title' && this.mode !== 'start') return
    this.markPlayStarted()
    this.mode = 'play'
    this.introStartedAt = null
    this.sound.unlock()
    this.sound.music(this.room.def.music ?? null)
  }

  // -------------------------------------------------------------------------
  // Start screen
  // -------------------------------------------------------------------------

  private updateStart(now: number): void {
    // The privacy panel opens on top of the start screen; reading it must not
    // start the game behind it.
    if (isOverlayOpen()) return
    // Nor may reaching the Privacy link with the keyboard: Tab and the bare
    // modifiers are how you get there, not "any key".
    const keys = [...this.display.keysPressed].filter((k) => !NOT_START_KEYS.has(k))
    const pressed = this.display.pointer.justPressed || keys.length > 0
    if (pressed) this.beginIntro(now)
  }

  private drawStart(now: number): void {
    const fb = this.display.fb
    const copy = this.content.ui.start
    if (!this.startFb || !copy) return
    fb.copyFrom(this.startFb)

    if (Math.floor(now / 500) % 2 === 0) {
      drawTextCentered(fb, copy.prompt, SCREEN_W / 2, 150, {
        color: C.uiVerbHot,
        outlineColor: C.black,
      })
    }
    if (copy.hint) {
      drawTextCentered(fb, copy.hint, SCREEN_W / 2, 168, { color: C.grey3 })
    }
    if (copy.footer) {
      drawTextCentered(fb, copy.footer, SCREEN_W / 2, 188, { color: C.grey2 })
    }
  }

  // -------------------------------------------------------------------------
  // Title card
  // -------------------------------------------------------------------------

  private updateTitle(now: number): void {
    const copy = this.content.ui.title
    if (!copy || this.introStartedAt === null) {
      this.mode = 'play'
      return
    }
    const pressed = this.display.pointer.justPressed || this.display.keysPressed.size > 0
    const elapsed = (now - this.introStartedAt) / 1000
    // A press skips the rest; otherwise the intro hands over on its own when
    // the theme's slow opening finishes and the tune proper starts.
    if (pressed || elapsed >= copy.ends_at) {
      // Whether the title card gets watched or clicked through is the cheapest
      // read there is on whether the opening is earning its ten seconds.
      this.analytics.trackOnce('intro_ended', { skipped: pressed, seconds: Math.round(elapsed) })
      this.mode = 'play'
      this.introStartedAt = null
      // Don't let the skipping press also act on the room behind the intro.
      this.swallowClicksUntil = now + 260
    }
  }

  private drawTitle(now: number): void {
    const fb = this.display.fb
    const copy = this.content.ui.title
    if (!this.titleFb || !copy) return

    fb.copyFrom(this.titleFb)
    animateTitle(fb, now / 1000)

    const elapsed = this.introStartedAt === null ? 0 : (now - this.introStartedAt) / 1000

    for (const line of copy.lines) {
      drawTextScaledCentered(fb, line.text, SCREEN_W / 2, line.y, line.scale ?? 2, {
        color: colorByName(line.color, C.moon2),
        outlineColor: C.black,
      })
    }
    if (copy.subtitle) {
      // Below the tallest title line, whatever scale it was set to.
      const bottom = copy.lines.reduce(
        (m, l) => Math.max(m, l.y + CELL_H * (l.scale ?? 2)),
        0,
      )
      drawTextCentered(fb, copy.subtitle, SCREEN_W / 2, bottom + 2, {
        color: C.grey5,
        outlineColor: C.black,
      })
    }

    // The roll: one caption at a time, each holding until the next is due.
    let current: string | null = null
    for (const item of copy.roll) if (elapsed >= item.at) current = item.text
    if (current) {
      const lines = balanceWrap(current, 260)
      let y = 158
      for (const l of lines) {
        drawTextCentered(fb, l, SCREEN_W / 2, y, { color: C.moon2, outlineColor: C.black })
        y += 11
      }
    }
    drawTextCentered(fb, copy.skip_hint, SCREEN_W / 2, 190, { color: C.grey3 })

    // Fade down towards the hand-over, so the game doesn't simply cut in.
    const fadeAt = copy.fade_out_at ?? copy.ends_at - 3
    if (elapsed > fadeAt) {
      const k = Math.min(1, (elapsed - fadeAt) / Math.max(0.5, copy.ends_at - fadeAt))
      this.dissolveToBlack(fb, k, SCREEN_H)
    }

    // …and fade up from black over the first second.
    if (elapsed < 1) this.dissolveToBlack(fb, 1 - elapsed, SCREEN_H)
  }

  /** Ordered 4x4 dissolve towards black — cheap, and very 1990. */
  private dissolveToBlack(fb: Framebuffer, amount: number, height: number): void {
    const step = Math.round(amount * 16)
    if (step <= 0) return
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < SCREEN_W; x++) {
        const t = ((x & 3) + ((y & 3) << 2)) % 16
        if (t < step) fb.set(x, y, C.black)
      }
    }
  }
}
