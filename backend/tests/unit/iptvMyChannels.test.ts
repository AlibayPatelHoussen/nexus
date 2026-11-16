import { cleanName, countryCode, parseM3u, splitCountry } from '../../src/services/iptvMyChannels'

describe('« Mes chaînes »: reading a list and names', () => {
  it('reads #EXTINF entries (attributes, names with commas), skips the rest', () => {
    const list = parseM3u([
      '﻿#EXTM3U',
      '#EXTINF:-1 tvg-logo="https://img.example/a.png" group-title="News, FR",FR - Info, le direct',
      'https://tv.example/info.m3u8',
      '#EXTINF:-1,Lost name',
      'not an address',
      'https://tv.example/no-extinf.m3u8',
      '#EXTVLCOPT:http-user-agent=x',
      'rtmp://tv.example/live',
    ].join('\r\n'))
    expect(list).toEqual([
      { name: 'FR - Info, le direct', url: 'https://tv.example/info.m3u8', attrs: { 'tvg-logo': 'https://img.example/a.png', 'group-title': 'News, FR' } },
      { name: '', url: 'https://tv.example/no-extinf.m3u8', attrs: {} },
    ])
  })

  it('cleans names and finds the country in a prefix', () => {
    expect(cleanName('[COLOR yellow][B]TF1[/B][/COLOR]   HD')).toBe('TF1 HD')
    expect(splitCountry('FR - TF1 HD')).toEqual({ name: 'TF1 HD', country: 'FR' })
    expect(splitCountry('|BE| La Une')).toEqual({ name: 'La Une', country: 'BE' })
    expect(splitCountry('UK: BBC One')).toEqual({ name: 'BBC One', country: 'UK' })
    expect(splitCountry('HD - Pas un pays')).toEqual({ name: 'HD - Pas un pays', country: null })
  })

  it('country codes the catalogue uses', () => {
    expect([countryCode('fr'), countryCode('GB'), countryCode('UK'), countryCode('HD'), countryCode('FRA'), countryCode('')])
      .toEqual(['FR', 'UK', 'UK', null, null, null])
  })
})

describe('codes left free for private use are no country', () => {
  it('ZZ, XA, QM…', () => {
    expect([countryCode('ZZ'), countryCode('XA'), countryCode('QM'), countryCode('XK')]).toEqual([null, null, null, 'XK'])
  })
})
