const FALLBACK_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Stockholm',
  'Europe/Warsaw',
  'Europe/Athens',
  'Europe/Istanbul',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Auckland',
];

let cachedZones: string[] | null = null;

export function getAllTimeZones(): string[] {
  if (cachedZones) return cachedZones;
  try {
    const intlAny = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    if (typeof intlAny.supportedValuesOf === 'function') {
      const list = intlAny.supportedValuesOf('timeZone');
      if (list.length > 0) {
        cachedZones = list.includes('UTC') ? list : ['UTC', ...list];
        return cachedZones;
      }
    }
  } catch {
    // Fallback below
  }
  cachedZones = FALLBACK_TIMEZONES;
  return cachedZones;
}

export function getLocalTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function getTimeZoneLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    }).formatToParts(new Date());
    const offset = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    return `${tz.replace(/_/g, ' ')} (${offset})`;
  } catch {
    return tz;
  }
}
