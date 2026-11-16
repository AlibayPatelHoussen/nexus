/**
 * `attachment; filename="Photo ete.jpg"; filename*=UTF-8''Photo%20%C3%A9t%C3%A9.jpg`: the name
 * in UTF-8 for every browser (Express writes « é » as a raw Latin-1 byte, which Chrome cuts to
 * « Photo_ »), with a plain ASCII copy for very old ones.
 */
export function contentDisposition(name: string, type: 'attachment' | 'inline' = 'attachment'): string {
  const ascii = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]|["\\%]/gu, '_') || 'fichier'
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${type}; filename="${ascii}"; filename*=UTF-8''${utf8}`
}
