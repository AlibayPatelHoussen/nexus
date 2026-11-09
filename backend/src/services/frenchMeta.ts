import fs from 'fs/promises'
import path from 'path'
import { scriptsDir } from './downloadScripts'

/*
 * French metadata for mangas and animes: MangaDex / AniList answer in English.
 * - MangaDex often has a French description (description.fr): used first;
 * - anime-sama's catalogue (downloaders/data/catalogue.json) keeps the French synopsis of
 *   every title whose page was opened (search, download): used next;
 * - MangaDex tags (genres) are only in English: translated here.
 */

const norm = (t: string) => t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const slug = (t: string) => norm(t).replace(/ /g, '-')

interface CatalogueItem { title?: string; slug?: string; description?: string }
let cache: { mtime: number; byKey: Map<string, string> } | null = null

/** French synopsis of this title in anime-sama's catalogue, if it has one. */
export async function catalogueSynopsis(...titles: (string | null | undefined)[]): Promise<string | null> {
  const file = path.join(scriptsDir(), 'data', 'catalogue.json')
  try {
    const st = await fs.stat(file)
    if (!cache || cache.mtime !== st.mtimeMs) {
      const items = JSON.parse(await fs.readFile(file, 'utf8')) as CatalogueItem[]
      const byKey = new Map<string, string>()
      for (const it of items) {
        const d = it.description?.trim()
        if (!d || d.length < 40) continue        // a real synopsis, not a one-word placeholder
        if (it.title) byKey.set(norm(it.title), d)
        if (it.slug) byKey.set(it.slug.toLowerCase(), d)
      }
      cache = { mtime: st.mtimeMs, byKey }
    }
    for (const t of titles) {
      if (!t) continue
      const hit = cache.byKey.get(norm(t)) ?? cache.byKey.get(slug(t))
      if (hit) return hit
    }
  } catch { /* no catalogue yet */ }
  return null
}

/** MangaDex tag names (English) → French. Unknown tags are kept as they are. */
const TAGS_FR: Record<string, string> = {
  Action: 'Action', Adventure: 'Aventure', Comedy: 'Comédie', Drama: 'Drame', Fantasy: 'Fantasy', Horror: 'Horreur',
  Mystery: 'Mystère', Romance: 'Romance', 'Sci-Fi': 'Science-fiction', 'Slice of Life': 'Tranche de vie', Sports: 'Sport',
  Thriller: 'Thriller', Tragedy: 'Tragédie', Psychological: 'Psychologique', Historical: 'Historique', Isekai: 'Isekai',
  'Magical Girls': 'Magical girls', Mecha: 'Mecha', Medical: 'Médical', Philosophical: 'Philosophique', Crime: 'Policier',
  Superhero: 'Super-héros', Wuxia: 'Wuxia', 'Martial Arts': 'Arts martiaux', Military: 'Militaire', Music: 'Musique',
  School: 'Scolaire', 'School Life': 'Vie scolaire', Supernatural: 'Surnaturel', Survival: 'Survie', Magic: 'Magie',
  Monsters: 'Monstres', Demons: 'Démons', Vampires: 'Vampires', Zombies: 'Zombies', Ghosts: 'Fantômes', Ninja: 'Ninja',
  Samurai: 'Samouraï', 'Time Travel': 'Voyage dans le temps', 'Post-Apocalyptic': 'Post-apocalyptique', 'Video Games': 'Jeux vidéo',
  'Reincarnation': 'Réincarnation', Villainess: 'Méchante', 'Office Workers': 'Employés de bureau', Cooking: 'Cuisine',
  Delinquents: 'Délinquants', Police: 'Police', Mafia: 'Mafia', Aliens: 'Extraterrestres', Animals: 'Animaux',
  'Monster Girls': 'Monster girls', Harem: 'Harem', 'Reverse Harem': 'Harem inversé', 'Gender Bender': 'Changement de genre',
  'Boys\' Love': 'Boys’ love', 'Girls\' Love': 'Girls’ love', 'Award Winning': 'Primé', 'Oneshot': 'One-shot',
  'Long Strip': 'Défilement vertical', 'Full Color': 'Couleur', 'Web Comic': 'Webcomic', Adaptation: 'Adaptation',
  Anthology: 'Anthologie', 'Self-Published': 'Autoédité', '4-Koma': '4-koma', Doujinshi: 'Doujinshi',
  'Official Colored': 'Colorisé officiel', 'Fan Colored': 'Colorisé par des fans', 'User Created': 'Créé par un utilisateur',
  Gyaru: 'Gyaru', Incest: 'Inceste', Loli: 'Loli', Shota: 'Shota', Sexual: 'Sexuel', Gore: 'Gore',
  'Sexual Violence': 'Violence sexuelle', 'Traditional Games': 'Jeux traditionnels', 'Virtual Reality': 'Réalité virtuelle',
  Crossdressing: 'Travestissement', 'Genderswap': 'Échange de genre',
}
export const tagFr = (tag: string) => TAGS_FR[tag] ?? tag
