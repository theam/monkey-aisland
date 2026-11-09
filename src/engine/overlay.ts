import type { Analytics } from './analytics'
import type { CountingCopy } from './content'

const overlayEl = () => document.getElementById('overlay') as HTMLDivElement

let escHandler: ((event: KeyboardEvent) => void) | null = null

export function hideOverlay(): void {
  const overlay = overlayEl()
  overlay.classList.remove('on')
  overlay.innerHTML = ''
  if (escHandler) {
    window.removeEventListener('keydown', escHandler)
    escHandler = null
  }
}

export function isOverlayOpen(): boolean {
  return overlayEl().classList.contains('on')
}

function openOverlay(onEscape?: () => void): HTMLDivElement {
  const overlay = overlayEl()
  overlay.innerHTML = ''
  overlay.classList.add('on')
  if (escHandler) window.removeEventListener('keydown', escHandler)
  escHandler = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && onEscape) {
      event.preventDefault()
      onEscape()
    }
  }
  window.addEventListener('keydown', escHandler)

  const inner = document.createElement('div')
  inner.className = 'ovl-inner'
  overlay.appendChild(inner)
  return inner
}

export type InterstitialCopy = {
  kicker?: string
  paragraphs: string[]
  button: string
  /** a way back, next to the button */
  cancel?: string
  /** a small line under the buttons */
  note?: string
  aside?: string
}

export type InterstitialOptions = {
  /** Make the button a real link that opens this URL in a new tab. */
  href?: string
  /** The `cancel` button, and Escape. */
  onCancel?: () => void
}

export function showInterstitial(
  copy: InterstitialCopy,
  onContinue: () => void,
  options: InterstitialOptions = {},
): void {
  const inner = openOverlay(options.onCancel)
  const box = document.createElement('div')
  box.className = 'interstitial'

  const heading = document.createElement('h2')
  heading.id = 'ovl-title'
  if (copy.kicker) {
    heading.className = 'kicker'
    heading.textContent = copy.kicker
  } else {
    heading.className = 'visually-hidden'
    heading.textContent = 'The Monkey AIsland'
  }
  box.appendChild(heading)

  for (const text of copy.paragraphs) {
    const paragraph = document.createElement('p')
    paragraph.textContent = text
    box.appendChild(paragraph)
  }

  // A real link when it leaves the game: the new tab opens from the click
  // itself, so no popup blocker gets a say.
  let button: HTMLAnchorElement | HTMLButtonElement
  if (options.href) {
    const link = document.createElement('a')
    link.href = options.href
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    button = link
  } else {
    const plain = document.createElement('button')
    plain.type = 'button'
    button = plain
  }
  button.className = 'mi-btn'
  button.textContent = copy.button
  button.addEventListener('click', onContinue)

  const actions = document.createElement('div')
  actions.className = 'actions'
  actions.appendChild(button)
  if (copy.cancel && options.onCancel) {
    const cancel = document.createElement('button')
    cancel.className = 'mi-link'
    cancel.type = 'button'
    cancel.textContent = copy.cancel
    cancel.addEventListener('click', options.onCancel)
    actions.appendChild(cancel)
  }
  box.appendChild(actions)

  if (copy.note) {
    const note = document.createElement('p')
    note.className = 'note'
    note.textContent = copy.note
    box.appendChild(note)
  }

  if (copy.aside) {
    const aside = document.createElement('p')
    aside.className = 'aside'
    aside.style.marginTop = '2.4em'
    aside.textContent = copy.aside
    box.appendChild(aside)
  }

  inner.appendChild(box)
  button.focus()
}

/** The game's own counting notice, and the analytics it describes. */
export type CountingPanel = { copy: CountingCopy; analytics: Analytics }

function createRightsLinks(privacy: CountingCopy['rights']): HTMLElement[] {
  const rights = document.createElement('p')
  rights.append(`${privacy.label} `)
  const rightsLink = document.createElement('a')
  rightsLink.href = `mailto:${privacy.email}`
  rightsLink.textContent = privacy.email
  rights.appendChild(rightsLink)
  rights.append('.')

  const complaint = document.createElement('p')
  const complaintLink = document.createElement('a')
  complaintLink.href = privacy.complaint_url
  complaintLink.target = '_blank'
  complaintLink.rel = 'noopener noreferrer'
  complaintLink.textContent = privacy.complaint
  complaint.appendChild(complaintLink)

  return [rights, complaint]
}

/**
 * The Privacy link on the start screen opens this: what the game counts, who
 * receives it, and the switch to stop it. It sits on top of the start screen,
 * which waits — reading it does not press START.
 */
export function showPrivacyPanel(counting: CountingPanel, onClose: () => void): void {
  const close = (): void => {
    hideOverlay()
    onClose()
  }

  const inner = openOverlay(close)
  const panel = document.createElement('section')
  panel.className = 'notice privacy-panel'
  panel.setAttribute('aria-labelledby', 'ovl-title')

  if (counting.copy.kicker) {
    const kicker = document.createElement('p')
    kicker.className = 'privacy-kicker'
    kicker.textContent = counting.copy.kicker
    panel.appendChild(kicker)
  }
  const heading = document.createElement('h1')
  heading.id = 'ovl-title'
  heading.textContent = counting.copy.title
  panel.appendChild(heading)

  panel.appendChild(createCountingSection(counting))
  const rights = document.createElement('div')
  rights.className = 'rights'
  rights.append(...createRightsLinks(counting.copy.rights))
  panel.appendChild(rights)

  const actions = document.createElement('div')
  actions.className = 'actions'
  const closeButton = document.createElement('button')
  closeButton.className = 'mi-btn'
  closeButton.type = 'button'
  closeButton.textContent = counting.copy.close
  closeButton.addEventListener('click', close)
  actions.appendChild(closeButton)
  panel.appendChild(actions)

  inner.appendChild(panel)
  // Focus the way out, but open at the top: the title is what they came for.
  closeButton.focus({ preventScroll: true })
}

/**
 * What is counted and the switch, as one block. The status line is read from
 * the analytics instance every time it is drawn, so it cannot drift from what
 * is actually being sent.
 *
 * The status and its switch come first because they are the only part that
 * depends on this visit, and the switch sits right under the line it changes.
 * When the browser has already said no, the status is the whole answer: the
 * facts fold away underneath, since none of them apply, and there is no
 * switch, since nothing on the page can overrule the browser.
 */
function createCountingSection({ copy, analytics }: CountingPanel): HTMLElement {
  const section = document.createElement('div')
  section.className = 'counting'

  const statusBox = document.createElement('div')
  statusBox.className = 'counting-status-box'
  statusBox.dataset.status = analytics.status
  const status = document.createElement('p')
  status.className = 'counting-status'
  status.setAttribute('role', 'status')
  statusBox.appendChild(status)

  const toggle = document.createElement('button')
  toggle.className = 'mi-link counting-toggle'
  toggle.type = 'button'
  toggle.addEventListener('click', () => {
    if (analytics.status === 'counting') analytics.optOut()
    else if (analytics.status === 'opted_out') analytics.optIn()
    render()
  })
  statusBox.appendChild(toggle)
  section.appendChild(statusBox)

  if (analytics.status !== 'off') {
    const facts = createCountingFacts(copy, analytics)
    if (analytics.status === 'browser_signal') {
      const folded = document.createElement('details')
      folded.className = 'counting-folded'
      const summary = document.createElement('summary')
      summary.textContent = copy.folded
      folded.append(summary, ...facts)
      section.appendChild(folded)
    } else {
      section.append(...facts)
    }
  }

  const render = (): void => {
    statusBox.dataset.status = analytics.status
    status.textContent = copy.status[analytics.status]
    // Only a choice that is the player's gets a button: a browser signal is
    // changed in the browser, and "off" has nothing to switch.
    const choosable = analytics.status === 'counting' || analytics.status === 'opted_out'
    toggle.hidden = !choosable
    toggle.textContent = analytics.status === 'counting' ? copy.opt_out : copy.opt_in
  }
  render()
  return section
}

/** The plain part, framed by the intro and outro that are allowed to joke. */
function createCountingFacts(copy: CountingCopy, analytics: Analytics): HTMLElement[] {
  const processor = copy.processors[analytics.provider] ?? 'the browser console (debug mode)'
  const out: HTMLElement[] = []
  const paragraph = (text: string, className?: string): void => {
    const p = document.createElement('p')
    if (className) p.className = className
    p.textContent = text
    out.push(p)
  }
  if (copy.intro) paragraph(copy.intro, 'counting-aside')
  for (const text of copy.paragraphs) paragraph(text.replaceAll('{processor}', processor))
  if (copy.outro) paragraph(copy.outro, 'counting-aside')
  return out
}
