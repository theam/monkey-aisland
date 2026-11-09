/**
 * Campaign tags: the `utm_` part of the address an ad or a shared link sent
 * the player to.
 *
 * They describe the link, not the person: everyone who clicks the same ad
 * arrives with the same tags. That is why they may ride on every analytics
 * event and on to the hiring chat, and why nothing else in the address may.
 * Ad networks append their own click ids (`twclid`, `gclid`, `fbclid`), which
 * are one per click and so one per person; those are never read. Only the
 * five names below are, from a fixed list.
 *
 * Values are normalised exactly as the hiring chat normalises its own arrival
 * tags, so the game's numbers and the chat's Canales panel file one ad under
 * one name.
 */

export const CAMPAIGN_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const

export type CampaignParam = (typeof CAMPAIGN_PARAMS)[number]

export type Campaign = Partial<Record<CampaignParam, string>>

/**
 * The tags passed on to the hiring chat. Not `utm_source`: on the chat link
 * that names the game itself, and is what files the conversation under
 * "monkey-aisland" in the chat's channel funnel.
 */
const FORWARDED: readonly CampaignParam[] = ['utm_medium', 'utm_campaign', 'utm_content', 'utm_term']

/** The analytics sanitiser's cut. Longer than this is not a tag. */
const MAX_TAG = 120

/**
 * The chat's rule: anything with an @ is an address, not a tag, and goes
 * entirely. Otherwise trim the ends, lower case, each run of whitespace to one
 * hyphen, drop everything outside [a-z0-9._-], and an empty result is no tag.
 * The chat trims plain spaces only and cuts at 200; the cut here is 120.
 */
export function campaignTag(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw.includes('@')) return null
  const tag = raw
    .replace(/^ +| +$/g, '')
    .toLowerCase()
    .replace(/[ \t\n\r\f\v]+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, MAX_TAG)
  return tag === '' ? null : tag
}

/** The campaign tags in a query string, normalised. Missing or empty ones are left out. */
export function readCampaign(search: string): Campaign {
  const campaign: Campaign = {}
  try {
    const params = new URLSearchParams(search)
    for (const name of CAMPAIGN_PARAMS) {
      const tag = campaignTag(params.get(name))
      if (tag) campaign[name] = tag
    }
  } catch {
    /* an address we cannot read carries no campaign */
  }
  return campaign
}

/**
 * The hiring chat link with the player's campaign tags added, so the chat can
 * tell which campaign a candidate came from. Tags already on the configured
 * link win; an unreadable link is returned as it is.
 */
export function chatLink(base: string, campaign: Campaign): string {
  try {
    const url = new URL(base)
    for (const name of FORWARDED) {
      const tag = campaign[name]
      if (tag && !url.searchParams.has(name)) url.searchParams.set(name, tag)
    }
    return url.toString()
  } catch {
    return base
  }
}
