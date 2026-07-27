/**
 * Timezone utilities — DST-aware via the Intl API.
 * GMT offsets are computed at runtime so they reflect current daylight saving time.
 */

export interface TimezoneEntry {
  tz: string;   // IANA identifier
  city: string; // "Country/City" display label
}

export const TIMEZONES_LIST: TimezoneEntry[] = [
  // ── UTC ──
  { tz: "UTC",                              city: "UTC" },
  // ── Pacific ──
  { tz: "Pacific/Midway",                   city: "USA/Midway Island" },
  { tz: "Pacific/Honolulu",                 city: "USA/Honolulu" },
  { tz: "America/Anchorage",                city: "USA/Anchorage" },
  // ── Americas ──
  { tz: "America/Los_Angeles",              city: "USA/Los Angeles" },
  { tz: "America/Vancouver",                city: "Canada/Vancouver" },
  { tz: "America/Tijuana",                  city: "Mexico/Tijuana" },
  { tz: "America/Denver",                   city: "USA/Denver" },
  { tz: "America/Phoenix",                  city: "USA/Phoenix" },
  { tz: "America/Chicago",                  city: "USA/Chicago" },
  { tz: "America/Mexico_City",              city: "Mexico/Mexico City" },
  { tz: "America/Winnipeg",                 city: "Canada/Winnipeg" },
  { tz: "America/New_York",                 city: "USA/New York" },
  { tz: "America/Toronto",                  city: "Canada/Toronto" },
  { tz: "America/Montreal",                 city: "Canada/Montreal" },
  { tz: "America/Bogota",                   city: "Colombia/Bogota" },
  { tz: "America/Lima",                     city: "Peru/Lima" },
  { tz: "America/Caracas",                  city: "Venezuela/Caracas" },
  { tz: "America/Halifax",                  city: "Canada/Halifax" },
  { tz: "America/Sao_Paulo",               city: "Brazil/São Paulo" },
  { tz: "America/Argentina/Buenos_Aires",   city: "Argentina/Buenos Aires" },
  { tz: "America/Santiago",                 city: "Chile/Santiago" },
  { tz: "America/St_Johns",                city: "Canada/St. John's" },
  // ── Atlantic ──
  { tz: "Atlantic/Cape_Verde",              city: "Cape Verde/Praia" },
  { tz: "Atlantic/Azores",                  city: "Portugal/Azores" },
  // ── Europe ──
  { tz: "Europe/London",                    city: "UK/London" },
  { tz: "Europe/Lisbon",                    city: "Portugal/Lisbon" },
  { tz: "Europe/Dublin",                    city: "Ireland/Dublin" },
  { tz: "Europe/Paris",                     city: "France/Paris" },
  { tz: "Europe/Brussels",                  city: "Belgium/Brussels" },
  { tz: "Europe/Berlin",                    city: "Germany/Berlin" },
  { tz: "Europe/Madrid",                    city: "Spain/Madrid" },
  { tz: "Europe/Rome",                      city: "Italy/Rome" },
  { tz: "Europe/Amsterdam",                 city: "Netherlands/Amsterdam" },
  { tz: "Europe/Zurich",                    city: "Switzerland/Zurich" },
  { tz: "Europe/Stockholm",                 city: "Sweden/Stockholm" },
  { tz: "Europe/Oslo",                      city: "Norway/Oslo" },
  { tz: "Europe/Copenhagen",                city: "Denmark/Copenhagen" },
  { tz: "Europe/Warsaw",                    city: "Poland/Warsaw" },
  { tz: "Europe/Prague",                    city: "Czech Republic/Prague" },
  { tz: "Europe/Vienna",                    city: "Austria/Vienna" },
  { tz: "Europe/Budapest",                  city: "Hungary/Budapest" },
  { tz: "Europe/Athens",                    city: "Greece/Athens" },
  { tz: "Europe/Bucharest",                 city: "Romania/Bucharest" },
  { tz: "Europe/Helsinki",                  city: "Finland/Helsinki" },
  { tz: "Europe/Kiev",                      city: "Ukraine/Kyiv" },
  { tz: "Europe/Istanbul",                  city: "Turkey/Istanbul" },
  { tz: "Europe/Moscow",                    city: "Russia/Moscow" },
  // ── Africa ──
  { tz: "Africa/Casablanca",                city: "Morocco/Casablanca" },
  { tz: "Africa/Algiers",                   city: "Algeria/Algiers" },
  { tz: "Africa/Tunis",                     city: "Tunisia/Tunis" },
  { tz: "Africa/Cairo",                     city: "Egypt/Cairo" },
  { tz: "Africa/Lagos",                     city: "Nigeria/Lagos" },
  { tz: "Africa/Johannesburg",              city: "South Africa/Johannesburg" },
  { tz: "Africa/Nairobi",                   city: "Kenya/Nairobi" },
  { tz: "Africa/Addis_Ababa",              city: "Ethiopia/Addis Ababa" },
  { tz: "Africa/Dakar",                     city: "Senegal/Dakar" },
  // ── Middle East ──
  { tz: "Asia/Jerusalem",                   city: "Israel/Jerusalem" },
  { tz: "Asia/Beirut",                      city: "Lebanon/Beirut" },
  { tz: "Asia/Amman",                       city: "Jordan/Amman" },
  { tz: "Asia/Damascus",                    city: "Syria/Damascus" },
  { tz: "Asia/Riyadh",                      city: "Saudi Arabia/Riyadh" },
  { tz: "Asia/Kuwait",                      city: "Kuwait/Kuwait City" },
  { tz: "Asia/Baghdad",                     city: "Iraq/Baghdad" },
  { tz: "Asia/Dubai",                       city: "UAE/Dubai" },
  { tz: "Asia/Muscat",                      city: "Oman/Muscat" },
  { tz: "Asia/Tehran",                      city: "Iran/Tehran" },
  { tz: "Asia/Baku",                        city: "Azerbaijan/Baku" },
  { tz: "Asia/Tbilisi",                     city: "Georgia/Tbilisi" },
  { tz: "Asia/Yerevan",                     city: "Armenia/Yerevan" },
  // ── Asia ──
  { tz: "Asia/Kabul",                       city: "Afghanistan/Kabul" },
  { tz: "Asia/Karachi",                     city: "Pakistan/Karachi" },
  { tz: "Asia/Colombo",                     city: "Sri Lanka/Colombo" },
  { tz: "Asia/Kolkata",                     city: "India/Kolkata" },
  { tz: "Asia/Kathmandu",                   city: "Nepal/Kathmandu" },
  { tz: "Asia/Dhaka",                       city: "Bangladesh/Dhaka" },
  { tz: "Asia/Yangon",                      city: "Myanmar/Yangon" },
  { tz: "Asia/Bangkok",                     city: "Thailand/Bangkok" },
  { tz: "Asia/Ho_Chi_Minh",                city: "Vietnam/Ho Chi Minh" },
  { tz: "Asia/Jakarta",                     city: "Indonesia/Jakarta" },
  { tz: "Asia/Singapore",                   city: "Singapore/Singapore" },
  { tz: "Asia/Kuala_Lumpur",               city: "Malaysia/Kuala Lumpur" },
  { tz: "Asia/Manila",                      city: "Philippines/Manila" },
  { tz: "Asia/Shanghai",                    city: "China/Shanghai" },
  { tz: "Asia/Hong_Kong",                   city: "Hong Kong/Hong Kong" },
  { tz: "Asia/Taipei",                      city: "Taiwan/Taipei" },
  { tz: "Asia/Seoul",                       city: "South Korea/Seoul" },
  { tz: "Asia/Tokyo",                       city: "Japan/Tokyo" },
  { tz: "Asia/Yakutsk",                     city: "Russia/Yakutsk" },
  { tz: "Asia/Vladivostok",                 city: "Russia/Vladivostok" },
  // ── Oceania ──
  { tz: "Australia/Perth",                  city: "Australia/Perth" },
  { tz: "Australia/Darwin",                 city: "Australia/Darwin" },
  { tz: "Australia/Adelaide",               city: "Australia/Adelaide" },
  { tz: "Australia/Brisbane",               city: "Australia/Brisbane" },
  { tz: "Australia/Sydney",                 city: "Australia/Sydney" },
  { tz: "Pacific/Noumea",                   city: "New Caledonia/Noumea" },
  { tz: "Pacific/Auckland",                 city: "New Zealand/Auckland" },
  { tz: "Pacific/Fiji",                     city: "Fiji/Suva" },
  { tz: "Pacific/Tongatapu",                city: "Tonga/Nukuʻalofa" },
];

/**
 * Returns the current GMT offset string for a timezone, e.g. "GMT+2", "GMT-5", "GMT".
 * DST-aware: uses the current time so it reflects summer/winter time automatically.
 */
export function getGMTOffset(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  } catch {
    return "GMT";
  }
}

/**
 * Returns the full label shown in the timezone picker, e.g. "GMT+2 France/Paris".
 */
export function getTimezoneLabel(entry: TimezoneEntry): string {
  const offset = getGMTOffset(entry.tz);
  return `${offset} ${entry.city}`;
}

/**
 * Numeric offset in hours for sorting, e.g. GMT+2 → 2, GMT-5 → -5, GMT → 0.
 * DST-aware.
 */
export function getOffsetHours(tz: string): number {
  try {
    const now = new Date();
    const utc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
    const local = new Date(now.toLocaleString("en-US", { timeZone: tz }));
    return (local.getTime() - utc.getTime()) / 3_600_000;
  } catch {
    return 0;
  }
}

/**
 * Format a date in the given IANA timezone.
 * Falls back to locale default if tz is invalid.
 */
export function formatInTimezone(
  date: string | Date,
  tz: string,
  options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  },
): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      ...options,
      timeZone: tz,
    }).format(new Date(date));
  } catch {
    return new Intl.DateTimeFormat("en-US", options).format(new Date(date));
  }
}
