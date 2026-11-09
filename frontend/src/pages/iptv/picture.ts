import type { PictureAnswer, PictureReason } from '@/services/iptvService'

/*
 * Channels that play with sound but no picture.
 *
 * Three causes, three answers (see IptvPlayerPage):
 * - the playlist lists a sound-only variant (for slow networks) and the player started on it:
 *   hls.js cannot bring the picture in afterwards. Those variants are left out (below);
 * - the video is in a format the browser does not read (MPEG-2, HEVC here and there): the server
 *   converts it live (services/iptvConvert.ts on the server);
 * - the channel sends no picture at all (a radio): said as such, the sound goes on.
 */

// ─── Streams this browser needs the server's conversion for ──────────────────────
/** What the player of this browser reads: Safari plays streams itself (`native`), the others
 *  go through hls.js and the browser's Media Source decoders */
export interface Reader { native: boolean; hevc: boolean; ac3: boolean; eac3: boolean }
const PLAIN_AUDIO = new Set(['aac', 'mp3', 'mp2'])

/**
 * Why this browser needs the server's conversion for a stream holding `held` (told by the
 * server), or null when it can play it as it is.
 * `unsure`: the browser may still show it — to be decided once playback had its chance.
 */
export function needsConversion(held: Pick<PictureAnswer, 'video' | 'audio' | 'interlaced' | 'plain'>, reader: Reader): { why: string; unsure: boolean } | null {
  const { video, audio } = held
  if (!video) return null          // a radio, or a stream the server could not read: nothing to decide from
  if (video !== 'h264' && !(video === 'hevc' && reader.hevc)) return { why: `vidéo ${video} non lue par ce navigateur`, unsure: false }
  if (video === 'h264' && !held.plain) return { why: 'vidéo H.264 hors du format courant (10 bits ou 4:2:2)', unsure: false }
  // Outside Safari the sound goes through the browser's own decoders: no Dolby in most of them
  if (!reader.native && audio && !PLAIN_AUDIO.has(audio) && !(audio === 'ac3' && reader.ac3) && !(audio === 'eac3' && reader.eac3)) {
    return { why: `son ${audio} non lu par ce navigateur`, unsure: false }
  }
  // Interlaced broadcast video passed on as it is: Safari often plays its sound over a black
  // screen until the stream is started again by hand — but not always
  if (reader.native && held.interlaced) return { why: 'vidéo entrelacée, non affichée par Safari', unsure: true }
  return null
}

/** « h264 entrelacé · son eac3 », for the playback details */
export function describeStream(held: Pick<PictureAnswer, 'video' | 'audio' | 'interlaced' | 'plain' | 'reason'>): string {
  if (!held.video && !held.audio) return held.reason === 'ffmpeg' ? 'non analysé (ffmpeg absent du serveur)' : 'non lu par le serveur'
  const video = held.video ? `${held.video}${held.interlaced ? ' entrelacé' : ''}${held.plain ? '' : ' (hors 8 bits 4:2:0)'}` : 'pas d’image'
  return `${video} · son ${held.audio ?? 'absent'}`
}

/** What the player needs to know of an hls.js level */
export interface Variant { uri: string; width?: number; videoCodec?: string; bitrate?: number }

/**
 * The variants of a stream to leave out, highest index first (the order hls.removeLevel needs):
 * those found to carry sound only (`silent`), and those announced without a picture when others
 * announce one, all at a higher bitrate (the server's relay leaves the same ones out, see
 * dropSoundOnlyVariants there). One variant always stays (the last one: hls.js orders them by bitrate).
 */
export function variantsToDrop(levels: readonly Variant[], silent: ReadonlySet<string>): number[] {
  const pictured = (l: Variant) => (l.width ?? 0) > 0 || !!l.videoCodec
  const withPicture = levels.filter(pictured)
  const below = (l: Variant) => withPicture.length > 0 && withPicture.every((o) => (o.bitrate ?? Infinity) > (l.bitrate ?? 0))
  const drop = levels.map((l, i) => (silent.has(l.uri) || (!pictured(l) && below(l)) ? i : -1)).filter((i) => i >= 0)
  if (drop.length >= levels.length) drop.pop()
  return drop.reverse()
}

// ─── Streams this browser needed the server's conversion for ─────────────────────
// Kept per browser (what is read differs from one to the next: HEVC plays on an iPhone, not
// in every desktop browser): next time the conversion is asked at once, without first
// playing a few seconds of sound over a black screen.
const KEY = 'nexus-iptv-converted'
const TTL = 7 * 24 * 3600_000
const read = (): Record<string, number> => {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) || '{}')
    return v && typeof v === 'object' ? v as Record<string, number> : {}
  } catch { return {} }
}

export function wasConverted(id: string, stream: number): boolean {
  const at = read()[`${id}#${stream}`]
  return typeof at === 'number' && Date.now() - at < TTL
}

export function rememberConverted(id: string, stream: number, on: boolean) {
  try {
    const memo = read()
    const now = Date.now()
    for (const k of Object.keys(memo)) if (!(now - memo[k] < TTL)) delete memo[k]
    if (on) memo[`${id}#${stream}`] = now
    else delete memo[`${id}#${stream}`]
    localStorage.setItem(KEY, JSON.stringify(memo))
  } catch { /* private mode: asked again next time */ }
}

// ─── Does this browser tell which frames it shows? ───────────────────────────────
// Safari can know the size of a stream's picture and still show none of it (sound over a black
// screen until the app is left and reopened). requestVideoFrameCallback tells when a frame is
// really shown; its silence only means something on a browser where it was seen to work.
const FRAMES = 'nexus-iptv-frames'
export function framesReported(): boolean {
  try { return localStorage.getItem(FRAMES) === '1' } catch { return false }
}
export function rememberFramesReported() {
  try { if (localStorage.getItem(FRAMES) !== '1') localStorage.setItem(FRAMES, '1') } catch { /* private mode */ }
}

/** Why a channel is left with its sound only, for the viewer */
export const SOUND_ONLY: Record<PictureReason, string> = {
  audio: 'Cette chaîne ne diffuse pas d’image, seulement du son.',
  ffmpeg: 'Ce navigateur ne lit pas le format de son image, et le serveur ne peut pas la convertir (ffmpeg n’y est pas installé).',
  busy: 'Ce navigateur ne lit pas le format de son image, et le serveur convertit déjà d’autres chaînes. Réessayez dans un moment.',
  unreadable: 'Ce navigateur n’affiche pas son image, et le serveur n’a pas pu lire le flux pour la convertir.',
  failed: 'Ce navigateur ne lit pas le format de son image, et sa conversion par le serveur a échoué.',
}
