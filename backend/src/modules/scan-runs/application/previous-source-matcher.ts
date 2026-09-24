import type { PreviousSourceSearchCandidate } from './ports'
import type { PreviousSourceIntent } from './previous-source-schemas'

export interface EvaluatedPreviousSourceCandidate extends PreviousSourceSearchCandidate {
  exactIdentifierMatch: boolean
  titleScore: number
  score: number
  reasons: string[]
}

export interface PreviousSourceMatchResult {
  outcome: 'VERIFIED' | 'NOT_FOUND' | 'AMBIGUOUS'
  selected: EvaluatedPreviousSourceCandidate | null
  candidates: EvaluatedPreviousSourceCandidate[]
}

export function selectPreviousSource(
  current: { publicationDate: string },
  intent: PreviousSourceIntent,
  candidates: PreviousSourceSearchCandidate[],
): PreviousSourceMatchResult {
  const evaluated = candidates.map((candidate) => evaluateCandidate(current, intent, candidate))
    .sort((left, right) => right.score - left.score || right.publicationDate.localeCompare(left.publicationDate))
  const verified = evaluated.filter((candidate) => isVerified(intent, candidate))
  if (verified.length === 0) return { outcome: 'NOT_FOUND', selected: null, candidates: evaluated }

  const [best, second] = verified
  if (second && Math.abs(best!.score - second.score) < 0.02 && best!.publicationDate === second.publicationDate && best!.title !== second.title) {
    return { outcome: 'AMBIGUOUS', selected: null, candidates: evaluated }
  }
  return { outcome: 'VERIFIED', selected: best!, candidates: evaluated }
}

function evaluateCandidate(
  current: { publicationDate: string },
  intent: PreviousSourceIntent,
  candidate: PreviousSourceSearchCandidate,
): EvaluatedPreviousSourceCandidate {
  const exactIdentifierMatch = intent.targetRegulationIdentifier
    ? containsExactIdentifier(candidate.title, intent.targetRegulationIdentifier)
    : false
  const titleScore = intent.targetRegulationTitle
    ? jaccard(tokens(intent.targetRegulationTitle), tokens(candidate.title))
    : 0
  const typeMatch = typeCompatible(intent.targetRegulationType, candidate.regulationType)
  const chronology = candidate.publicationDate < current.publicationDate
  const score = round((exactIdentifierMatch ? 0.55 : 0) + titleScore * 0.3 + (typeMatch ? 0.1 : 0) + (chronology ? 0.05 : 0))
  const reasons = [
    ...(exactIdentifierMatch ? ['EXACT_IDENTIFIER'] : []),
    ...(titleScore >= 0.55 ? ['TITLE_SIMILAR'] : []),
    ...(typeMatch ? ['TYPE_MATCH'] : []),
    ...(chronology ? ['CHRONOLOGY_VALID'] : []),
  ]
  return { ...candidate, exactIdentifierMatch, titleScore: round(titleScore), score, reasons }
}

function isVerified(intent: PreviousSourceIntent, candidate: EvaluatedPreviousSourceCandidate): boolean {
  if (!candidate.reasons.includes('CHRONOLOGY_VALID')) return false
  if (intent.targetRegulationIdentifier) {
    return candidate.exactIdentifierMatch && candidate.reasons.includes('TYPE_MATCH') && candidate.titleScore >= 0.45
  }
  return candidate.reasons.includes('TYPE_MATCH') && candidate.titleScore >= 0.65
}

export function containsExactIdentifier(value: string, identifier: string): boolean {
  const escaped = identifier.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?<![0-9])${escaped}(?![0-9])`, 'iu').test(value)
}

export function normalizedTitle(value: string): string {
  return value.toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function tokens(value: string): Set<string> {
  const ignored = new Set(['bir', 've', 'ile', 'dair', 'sayili', 'sayisi', 'no', 'degisiklik', 'yapilmasina'])
  return new Set(normalizedTitle(value).split(/\s+/).filter((token) => token.length > 2 && !ignored.has(token)))
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0
  const intersection = [...left].filter((token) => right.has(token)).length
  return intersection / new Set([...left, ...right]).size
}

function typeCompatible(target: string | null, candidate: string | null): boolean {
  if (!target) return true
  if (!candidate) return false
  const expected = normalizedTitle(target)
  const actual = normalizedTitle(candidate)
  if (expected.includes('teblig')) return actual.includes('teblig')
  if (expected.includes('yonetmelik')) return actual.includes('yonetmelik')
  if (expected.includes('karar')) return actual.includes('karar')
  if (expected.includes('kanun')) return actual.includes('kanun')
  return actual.includes(expected)
}

function round(value: number): number {
  return Math.round(value * 1_000) / 1_000
}
