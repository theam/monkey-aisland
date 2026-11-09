export const TOUCH_PRIMARY_QUERY = '(hover: none) and (pointer: coarse)'

export const PORTRAIT_PHONE_QUERY =
  '(max-width: 600px) and (orientation: portrait) and (hover: none) and (pointer: coarse)'

export function usesTouchPrimaryInput(): boolean {
  return matchMedia(TOUCH_PRIMARY_QUERY).matches
}
