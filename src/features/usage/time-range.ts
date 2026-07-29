export function recentDateKeys(days: number, timeZone: string): string[] {
  const today = localDate(new Date(), timeZone)
  const anchor = new Date(`${today}T12:00:00.000Z`)
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(anchor)
    date.setUTCDate(anchor.getUTCDate() - (days - index - 1))
    return date.toISOString().slice(0, 10)
  })
}

export function dateKeysBetween(
  start: Date,
  end: Date,
  timeZone: string,
): string[] {
  const startKey = localDate(start, timeZone)
  const endKey = localDate(end, timeZone)
  const cursor = new Date(`${startKey}T12:00:00.000Z`)
  const last = new Date(`${endKey}T12:00:00.000Z`)
  const keys: string[] = []
  while (cursor <= last) {
    keys.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return keys
}

export function zonedStart(date: string, timeZone: string): Date {
  const utcNoon = new Date(`${date}T12:00:00.000Z`)
  const formatter = new Intl.DateTimeFormat('en', {
    timeZone,
    timeZoneName: 'longOffset',
  })
  const rawOffset = formatter.formatToParts(utcNoon)
    .find((part) => part.type === 'timeZoneName')?.value
    .replace('GMT', '') || '+00:00'
  const offset = normalizeOffset(rawOffset)
  return new Date(`${date}T00:00:00${offset}`)
}

function localDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return `${read('year')}-${read('month')}-${read('day')}`
}

function normalizeOffset(value: string): string {
  const match = /^([+-])(\d{1,2})(?::(\d{2}))?$/.exec(value)
  if (!match) return '+00:00'
  return `${match[1]}${match[2]!.padStart(2, '0')}:${match[3] ?? '00'}`
}
