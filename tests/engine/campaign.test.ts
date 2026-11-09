import { readFileSync } from 'node:fs'
import { load as parseYaml } from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { campaignTag, chatLink, readCampaign } from '../../src/engine/campaign'

/**
 * Campaign tags are the one thing from outside the game that reaches the
 * analytics and the hiring chat. These pin that only the ad's tags get
 * through — never a click id, never an address — and that they are spelt the
 * way the chat spells them, so one ad has one name on both sides.
 */

const CHAT = 'https://hiring.theagilemonkeys.com/?utm_source=monkey-aisland'

describe('campaign tags are normalised like the hiring chat’s', () => {
  // The chat's normalizaMarca, case by case: accents and punctuation are
  // dropped rather than transliterated, exactly as the chat drops them.
  it.each([
    ['monkey-aisland', 'monkey-aisland'],
    ['  Paid Social  ', 'paid-social'],
    ['launch_q4.v2', 'launch_q4.v2'],
    ['Campaña Otoño', 'campaa-otoo'],
    ['tabs\tand\nnewlines', 'tabs-and-newlines'],
    ['¡!', null],
    ['', null],
  ])('%j becomes %j', (raw, tag) => {
    expect(campaignTag(raw)).toBe(tag)
  })

  it('drops anything with an @ entirely: that is an address, not a tag', () => {
    expect(campaignTag('juan.perez@example.com')).toBeNull()
    expect(campaignTag('newsletter-@juan')).toBeNull()
  })

  it('cuts at the analytics sanitiser’s 120 characters, so a long tag is shortened, not lost', () => {
    expect(campaignTag('a'.repeat(300))).toHaveLength(120)
  })
})

describe('reading the arrival link', () => {
  it('reads the five utm_ tags and nothing else', () => {
    const campaign = readCampaign(
      '?utm_source=x&utm_medium=paid-social&utm_campaign=launch&utm_content=duel-video&utm_term=devs' +
        '&twclid=2-abc&gclid=xyz&fbclid=123&email=a%40b.c&analytics',
    )

    expect(campaign).toEqual({
      utm_source: 'x',
      utm_medium: 'paid-social',
      utm_campaign: 'launch',
      utm_content: 'duel-video',
      utm_term: 'devs',
    })
  })

  it('leaves out tags that are missing, empty or normalise to nothing', () => {
    expect(readCampaign('')).toEqual({})
    expect(readCampaign('?utm_campaign=&utm_content=%40me&utm_term=!!!')).toEqual({})
  })

  it('decodes the address before normalising it', () => {
    expect(readCampaign('?utm_campaign=Launch+Q4').utm_campaign).toBe('launch-q4')
  })
})

describe('the hiring chat link', () => {
  it('is the configured link, untouched, when the visit arrived without tags', () => {
    expect(chatLink(CHAT, {})).toBe(CHAT)
  })

  it('passes the campaign on, but keeps the game as the source', () => {
    const link = new URL(
      chatLink(CHAT, readCampaign('?utm_source=x&utm_medium=paid-social&utm_campaign=launch&utm_content=duel&utm_term=devs')),
    )

    expect(link.origin + link.pathname).toBe('https://hiring.theagilemonkeys.com/')
    expect(Object.fromEntries(link.searchParams)).toEqual({
      utm_source: 'monkey-aisland',
      utm_medium: 'paid-social',
      utm_campaign: 'launch',
      utm_content: 'duel',
      utm_term: 'devs',
    })
  })

  it('never passes on a click id or anything but the tags', () => {
    const link = new URL(chatLink(CHAT, readCampaign('?utm_campaign=launch&twclid=2-abc&visitor=123')))

    expect([...link.searchParams.keys()]).toEqual(['utm_source', 'utm_campaign'])
  })

  it('lets tags already on the configured link win', () => {
    const link = new URL(chatLink(`${CHAT}&utm_medium=game`, { utm_medium: 'paid-social' }))

    expect(link.searchParams.get('utm_medium')).toBe('game')
  })

  it('returns a link it cannot parse as it is, rather than breaking the last screen', () => {
    expect(chatLink('not a url', { utm_campaign: 'launch' })).toBe('not a url')
  })

  it('keeps the shipped chat link’s source tag', () => {
    const game = parseYaml(readFileSync('public/content/game.yaml', 'utf8')) as { chat: { url: string } }
    const link = new URL(chatLink(game.chat.url, { utm_campaign: 'launch' }))

    expect(link.searchParams.get('utm_source')).toBe('monkey-aisland')
    expect(link.searchParams.get('utm_campaign')).toBe('launch')
  })
})
