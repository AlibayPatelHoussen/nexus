import fs from 'fs'
import path from 'path'
import type { Namespace } from 'socket.io'
import { query } from '../config/database'
import { logger } from '../utils/logger'
import { AppError, NotFoundError } from '../utils/errors'
import { NEXUS_ROOT } from './files'
import { sendPush } from './push'

/**
 * Transferts (Aperçu, admins): a file sent from one device (iPhone, computer…) shows at once on
 * the account's other devices (live, and a notification), to be downloaded there; it is erased
 * after a few days. Files sit in TRANSFERS_DIR under their id (never a name given by the browser),
 * out of Git and out of the backups.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const transfersDir = () => path.resolve(process.env.TRANSFERS_DIR || path.join(NEXUS_ROOT, 'transfers'))
/** Where uploads land while they are received */
export const incomingDir = () => path.join(transfersDir(), '.incoming')
const keepDays = () => Math.min(Math.max(Math.floor(Number(process.env.TRANSFERS_KEEP_DAYS) || 7), 1), 90)
/** One file at most, and files at once */
export const MAX_TRANSFER_BYTES = 20 * 1024 * 1024 * 1024
export const MAX_TRANSFER_FILES = 50

export function ensureDirs() {
  fs.mkdirSync(incomingDir(), { recursive: true, mode: 0o700 })
}

interface TransferRow { id: string; user_id: string; name: string; size: string; mime: string | null; device: string | null; created_at: Date; expires_at: Date }

function publicTransfer(r: TransferRow) {
  return { id: r.id, name: r.name, size: Number(r.size), mime: r.mime, device: r.device, createdAt: r.created_at, expiresAt: r.expires_at }
}
export type Transfer = ReturnType<typeof publicTransfer>

/** « photo.jpg » from a multipart name (busboy decodes it as latin1), without path or control characters */
export function cleanFileName(raw: string): string {
  let name = raw
  try { name = Buffer.from(raw, 'latin1').toString('utf8') } catch { /* keep it */ }
  if (name.includes('\uFFFD')) name = raw                   // it was already UTF-8
  // eslint-disable-next-line no-control-regex -- control characters are what is removed
  name = path.basename(name.replace(/\\/g, '/')).replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (!name || name === '.' || name === '..') name = 'fichier'
  if (name.length > 200) {
    const ext = path.extname(name).slice(0, 20)
    name = name.slice(0, 200 - ext.length) + ext
  }
  return name
}

// ─── Live: the account's other devices hear about it ─────────────────────────────
let ns: Namespace | null = null
export function setTransfersNamespace(n: Namespace) { ns = n }

/** To every open page of the account (the page that did it knows itself by `client`). */
function tell(userId: string, event: string, payload: unknown) {
  ns?.to(`user:${userId}`).emit(event, payload)
}

/** Who sends: the account, its device session, and the page (a random id it gives) */
export interface Sender { userId: string; sid?: string; client?: string }
const CLIENT = /^[A-Za-z0-9_-]{8,64}$/

const client = (user: Sender) => (user.client && CLIENT.test(user.client) ? user.client : null)

// ─── API ───────────────────────────────────────────────────────────────────────
export async function listTransfers(userId: string): Promise<Transfer[]> {
  const { rows } = await query<TransferRow>(
    'SELECT * FROM transfers WHERE user_id = $1 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 500', [userId])
  return rows.map(publicTransfer)
}

export interface Received { path: string; originalname: string; size: number; mimetype: string }

/** Files just received (in incomingDir): kept under their id, the account's other devices told. */
export async function addTransfers(user: Sender, files: Received[], device: string | null): Promise<Transfer[]> {
  const added: Transfer[] = []
  try {
    for (const f of files) {
      const { rows } = await query<TransferRow>(
        `INSERT INTO transfers (user_id, name, size, mime, device, expires_at)
         VALUES ($1, $2, $3, $4, $5, NOW() + make_interval(days => $6)) RETURNING *`,
        [user.userId, cleanFileName(f.originalname), f.size, (f.mimetype || '').slice(0, 120) || null, device, keepDays()])
      await fs.promises.rename(f.path, path.join(transfersDir(), rows[0].id))
      added.push(publicTransfer(rows[0]))
    }
  } finally {
    // A file not kept (an error on the way) leaves no trace
    for (const f of files) await fs.promises.rm(f.path, { force: true }).catch(() => {})
  }
  if (added.length) {
    tell(user.userId, 'transfer:added', { items: added, from: device, client: client(user) })
    const first = added[0]
    const what = added.length > 1 ? `${added.length} fichiers` : `« ${first.name} »`
    void sendPush([user.userId], {
      title: added.length > 1 ? 'Fichiers reçus' : 'Fichier reçu',
      body: `${what}${device ? ` depuis ${device}` : ''}`,
      url: '/dashboard#transferts', tag: `transfer-${first.id}`,
    }, { exceptSession: user.sid }).catch((err: Error) => logger.warn(`Transfer push: ${err.message}`))
  }
  return added
}

/** The file to send back (its owner only). */
export async function transferFile(userId: string, id: string) {
  if (!UUID.test(id)) throw new NotFoundError('Fichier')
  const { rows } = await query<TransferRow>('SELECT * FROM transfers WHERE id = $1 AND user_id = $2 AND expires_at > NOW()', [id, userId])
  if (!rows[0]) throw new NotFoundError('Fichier')
  const file = path.join(transfersDir(), rows[0].id)
  if (!fs.existsSync(file)) throw new AppError('Ce fichier n’est plus sur le serveur', 410)
  return { file, name: rows[0].name, mime: rows[0].mime, size: Number(rows[0].size) }
}

export async function removeTransfer(user: Sender, id: string) {
  if (!UUID.test(id)) throw new NotFoundError('Fichier')
  const { rows } = await query<{ id: string }>('DELETE FROM transfers WHERE id = $1 AND user_id = $2 RETURNING id', [id, user.userId])
  if (!rows[0]) throw new NotFoundError('Fichier')
  await fs.promises.rm(path.join(transfersDir(), id), { force: true })
  tell(user.userId, 'transfer:removed', { ids: [id], client: client(user) })
}

export async function clearTransfers(user: Sender): Promise<number> {
  const { rows } = await query<{ id: string }>('DELETE FROM transfers WHERE user_id = $1 RETURNING id', [user.userId])
  for (const r of rows) await fs.promises.rm(path.join(transfersDir(), r.id), { force: true })
  if (rows.length) tell(user.userId, 'transfer:removed', { ids: rows.map((r) => r.id), client: client(user) })
  return rows.length
}

/** Expired transfers, files left without a row, uploads cut off more than a day ago. */
export async function cleanTransfers(): Promise<number> {
  const { rows } = await query<{ id: string; user_id: string }>('DELETE FROM transfers WHERE expires_at <= NOW() RETURNING id, user_id')
  for (const r of rows) await fs.promises.rm(path.join(transfersDir(), r.id), { force: true })
  const byUser = new Map<string, string[]>()
  for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r.id])
  for (const [userId, ids] of byUser) tell(userId, 'transfer:removed', { ids })

  const dayAgo = Date.now() - 24 * 3600_000
  try {
    const known = new Set((await query<{ id: string }>('SELECT id FROM transfers')).rows.map((r) => r.id))
    for (const name of await fs.promises.readdir(transfersDir())) {
      if (UUID.test(name) && !known.has(name)) await fs.promises.rm(path.join(transfersDir(), name), { force: true })
    }
    for (const name of await fs.promises.readdir(incomingDir())) {
      const p = path.join(incomingDir(), name)
      if ((await fs.promises.stat(p)).mtimeMs < dayAgo) await fs.promises.rm(p, { force: true })
    }
  } catch { /* the folder is made at the first transfer */ }
  return rows.length
}

let timer: NodeJS.Timeout | null = null
export function startTransfersWorker() {
  if (timer || process.env.NODE_ENV === 'test') return
  const run = () => { void cleanTransfers().catch((err: Error) => logger.warn(`Transfers clean-up: ${err.message}`)) }
  timer = setInterval(run, 3600_000)
  timer.unref()
  setTimeout(run, 30_000).unref()
}

/** Free space where transfers are kept (to refuse what cannot fit, before receiving it). */
export async function freeBytes(): Promise<number | null> {
  try {
    ensureDirs()
    const s = await fs.promises.statfs(transfersDir())
    return s.bavail * s.bsize
  } catch { return null }
}
