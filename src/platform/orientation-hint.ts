import { PORTRAIT_PHONE_QUERY } from './media'

export function setupOrientationHint(hint: HTMLElement): void {
  const portraitPhone = matchMedia(PORTRAIT_PHONE_QUERY)
  const dismiss = hint.querySelector<HTMLButtonElement>('[data-dismiss-orientation]')
  if (!dismiss) throw new Error('orientation hint has no dismiss button')

  let dismissed = false

  const updateVisibility = (): void => {
    hint.hidden = dismissed || !portraitPhone.matches
  }

  dismiss.addEventListener('click', () => {
    dismissed = true
    updateVisibility()
  })
  portraitPhone.addEventListener('change', () => {
    if (!portraitPhone.matches) dismissed = true
    updateVisibility()
  })
  updateVisibility()
}
