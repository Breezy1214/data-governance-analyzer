import nlp from "compromise";
import { bareWord, isKnownOrganization, isKnownWord } from "./known-words";

/**
 * Screens free text for personal and confidential values so the use-case
 * description only ever describes data, never contains it. "We match customer
 * email addresses" is fine; "jane@example.com" is not.
 *
 * Detection runs on a normalized copy of the text (NFKC, invisible characters
 * dropped, dash variants unified) so look-alike digits, zero-width characters
 * and fullwidth "＠" can't slip values past the patterns. Every finding is
 * mapped back to the original text so it can be redacted in place.
 */

export type SensitiveKind =
  | "secret"
  | "email"
  | "deviceId"
  | "ipAddress"
  | "bankAccount"
  | "card"
  | "governmentId"
  | "idNumber"
  | "dateOfBirth"
  | "phone"
  | "address"
  | "age"
  | "handle"
  | "name";

export type SensitiveFinding = { kind: SensitiveKind; start: number; end: number };

const KIND_DETAILS: Record<SensitiveKind, { label: string; placeholder: string }> = {
  secret: { label: "a password, key, or access token", placeholder: "[secret]" },
  email: { label: "an email address", placeholder: "[email]" },
  deviceId: { label: "a device or advertising ID", placeholder: "[device ID]" },
  ipAddress: { label: "an IP address", placeholder: "[IP address]" },
  bankAccount: { label: "a bank account number", placeholder: "[account number]" },
  card: { label: "a payment card number", placeholder: "[card number]" },
  governmentId: { label: "a Social Security or other government ID number", placeholder: "[ID number]" },
  idNumber: { label: "an ID or account number", placeholder: "[ID number]" },
  dateOfBirth: { label: "a date of birth", placeholder: "[date of birth]" },
  phone: { label: "a phone number", placeholder: "[phone]" },
  address: { label: "a street address or postcode", placeholder: "[address]" },
  age: { label: "a person's age", placeholder: "[age]" },
  handle: { label: "a username or social media handle", placeholder: "[handle]" },
  name: { label: "a person's name", placeholder: "[name]" },
};

/** Long pastes are bounded before parsing; the description itself holds far less. */
const MAX_SCAN_LENGTH = 20_000;

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/u;
const DASHES = /[‐-―−﹘﹣－]/u;

type Normalized = { text: string; starts: number[]; ends: number[] };

function normalize(source: string): Normalized {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let index = 0;
  for (const char of source) {
    if (!INVISIBLE.test(char)) {
      const mapped = DASHES.test(char) ? "-" : char.normalize("NFKC");
      for (let unit = 0; unit < mapped.length; unit += 1) {
        starts.push(index);
        ends.push(index + char.length);
      }
      text += mapped;
    }
    index += char.length;
  }
  return { text, starts, ends };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const intersects = (item: SensitiveFinding, start: number, end: number) => start < item.end && end > item.start;

class Claims {
  readonly found: SensitiveFinding[] = [];

  overlaps(start: number, end: number): boolean {
    return this.found.some((item) => intersects(item, start, end));
  }

  add(kind: SensitiveKind, start: number, end: number): void {
    if (end <= start) return;
    const overlapping = this.found.filter((item) => intersects(item, start, end));
    if (overlapping.length === 0) {
      this.found.push({ kind, start, end });
    } else if (kind === "name" && overlapping.every((item) => item.kind === "name")) {
      // Two name checks can each see part of one name ("Charles" and "Okafor"); keep the whole of it.
      const merged = { kind, start: Math.min(start, ...overlapping.map((item) => item.start)), end: Math.max(end, ...overlapping.map((item) => item.end)) };
      this.found.splice(0, this.found.length, ...this.found.filter((item) => !overlapping.includes(item)), merged);
    }
  }
}

type Detector = (text: string, claims: Claims, now: Date) => void;

function each(pattern: RegExp, text: string, visit: (match: RegExpExecArray) => void): void {
  for (const match of text.matchAll(pattern)) visit(match);
}

function claimAll(kind: SensitiveKind, pattern: RegExp, accept?: (match: RegExpExecArray) => boolean): Detector {
  return (text, claims) => each(pattern, text, (match) => {
    if (!accept || accept(match)) claims.add(kind, match.index, match.index + match[0].length);
  });
}

/** Claims capture group 1 only, so labels such as "SSN:" stay readable after redaction. */
function claimValue(kind: SensitiveKind, pattern: RegExp, accept?: (value: string, match: RegExpExecArray) => boolean): Detector {
  return (text, claims) => each(pattern, text, (match) => {
    const value = match[1];
    const span = match.indices?.[1];
    if (value && span && (!accept || accept(value, match))) claims.add(kind, span[0], span[1]);
  });
}

const digitsOf = (value: string) => value.replace(/\D/g, "");

/** First letter in either case: "customer" matches "Customer" but the name after it must be capitalized. */
const anyCaseFirst = (word: string) => `[${word[0].toUpperCase()}${word[0]}]${word.slice(1)}`;
const anyCaseWords = (words: string[]) => `(?:${words.map(anyCaseFirst).join("|")})`;

function luhn(digits: string): boolean {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

function ibanIsValid(candidate: string): boolean {
  const compact = candidate.replace(/\s/g, "").toUpperCase();
  if (compact.length < 15 || compact.length > 34) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const char of rearranged) {
    const value = /\d/.test(char) ? char : String(char.charCodeAt(0) - 55);
    for (const digit of value) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

// ---------------------------------------------------------------------------
// Detectors, in priority order: a span claimed earlier is never re-labelled.
// ---------------------------------------------------------------------------

const SECRET_FORMATS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/gi,
];

const labelledSecret = claimValue(
  "secret",
  new RegExp(String.raw`\b(?:password|passwd|pwd|passcode|passphrase|pin|secret|(?:api|access|secret|private)[ _-]?key|(?:auth|access|refresh|bearer)[ _-]?token|token|credentials?)\s*(?:[:=]|\bis\b)\s*["'\`]?([^\s"'\`]{3,})`, "gid"),
  (value, match) => /[:=]/.test(match[0]) || /[\d\W_]/.test(value),
);

const EMAIL_LOCAL = String.raw`[A-Za-z0-9!#$%&'*+/=?^_\`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_\`{|}~-]+)*`;
const EMAIL_DOMAIN = String.raw`[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?`;
const emails: Detector[] = [
  claimAll("email", new RegExp(String.raw`${EMAIL_LOCAL}\s*@\s*${EMAIL_DOMAIN}(?:\s*\.\s*${EMAIL_DOMAIN})*\s*\.\s*[A-Za-z]{2,24}\b`, "g")),
  // Obfuscated forms: "jane [at] example [dot] com", "jane at example dot com".
  claimAll("email", new RegExp(String.raw`[\w.+-]+\s*[[({<]\s*at\s*[\])}>]\s*[\w-]+(?:\s*(?:[[({<]\s*dot\s*[\])}>]|\.|\s+dot\s+)\s*[\w-]+)+`, "gi")),
  claimAll("email", /[\w.+-]+\s+at\s+[\w-]+(?:\s+dot\s+[\w-]+)+\b/gi),
];

const HEX = "[0-9A-Fa-f]";
const deviceIds: Detector[] = [
  claimAll("deviceId", new RegExp(String.raw`\b${HEX}{8}-${HEX}{4}-${HEX}{4}-${HEX}{4}-${HEX}{12}\b`, "g")),
  // MAC address.
  claimAll("deviceId", new RegExp(String.raw`\b${HEX}{2}([:-])(?:${HEX}{2}\1){4}${HEX}{2}\b`, "g")),
];

const ipAddresses: Detector[] = [
  claimAll("ipAddress", /(?<![\w:])[0-9A-Fa-f]{0,4}(?::[0-9A-Fa-f]{0,4}){2,7}(?![\w:])/g, ([value]) => {
    const groups = value.split(":");
    const compressed = value.includes("::");
    // A full address has eight groups, which rules out clock times such as 10:30:00.
    if (!compressed && groups.length !== 8) return false;
    return compressed ? groups.some(Boolean) : true;
  }),
  claimAll(
    "ipAddress",
    /(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\w.]*\d)/g,
    (match) => !/\bv(?:ersion)?\s*$/i.test(match.input.slice(Math.max(0, match.index - 10), match.index)),
  ),
];

const bankAccounts: Detector[] = [
  claimAll("bankAccount", /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g, ([value]) => ibanIsValid(value)),
  claimAll("bankAccount", /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g, ([value]) => ibanIsValid(value)),
];

const NUMBERED = String.raw`(?:\s+(?:number|no\.?|#))?`;
const STRONG_ID_LABELS = [
  "ssn", "ssn?#", String.raw`social\s+security${NUMBERED}`, "sin", "nino?", `nhs${NUMBERED}`, "mrn",
  String.raw`medical\s+record${NUMBERED}`, `passport${NUMBERED}`, String.raw`driver'?s?\s+licen[cs]e${NUMBERED}`,
  "ein", "itin", "tin", "iban", `routing${NUMBERED}`, String.raw`sort\s+code`, "npi", "dea",
];
const SOFT_ID_LABELS = [
  "patient", "member", "customer", "client", "employee", "student", "user", "subscriber", "account", "acct",
  "policy", "claim", "tax", "national", "voter", "insurance", "loyalty", "licen[cs]e", "card", "case", "record",
  "bank", "health\\s+plan", "beneficiary", "device", "vehicle", "vin",
];
const ID_SUFFIX = String.raw`(?:id|identifier|number|num|no\.?|#|code)`;
const ID_LABEL = String.raw`(?:${STRONG_ID_LABELS.join("|")}|(?:${SOFT_ID_LABELS.join("|")})\s*${ID_SUFFIX}|id|identifier)`;
const ID_VALUE = String.raw`[A-Z0-9](?:[A-Z0-9]|[-/.](?=[A-Z0-9])|\s(?=\d))*`;

const governmentIds: Detector[] = [
  // US Social Security / ITIN in its usual shapes, including nine bare digits.
  claimAll("governmentId", /(?<![\d-])\d{3}([-. ]?)\d{2}\1\d{4}(?![\d-])/g, ([value]) => {
    // Area 000, group 00 and serial 0000 are never issued, which also lets round quantities through.
    const digits = digitsOf(value);
    return !digits.startsWith("000") && digits.slice(3, 5) !== "00" && !digits.endsWith("0000");
  }),
  // UK National Insurance number.
  claimAll("governmentId", /\b[A-CEGHJ-PR-TW-Z]{2}\s?\d{2}\s?\d{2}\s?\d{2}\s?[A-D]\b/g),
];

const labelledIds = claimValue(
  "idNumber",
  new RegExp(String.raw`\b${ID_LABEL}\s*(?:is|was|of|:|=|#|-)?\s*#?\s*(${ID_VALUE})`, "gid"),
  (value) => digitsOf(value).length >= 3,
);

const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?`;
const ORDINAL = String.raw`(?:st|nd|rd|th)?`;
const BIRTH_WORD = String.raw`(?:born|dob|d\.\s?o\.\s?b\.?|date\s+of\s+birth|birth\s*date|birthday|b-?day)`;
const BIRTH_CONTEXT = new RegExp(String.raw`\b${BIRTH_WORD}\b`, "i");
/** A person must be at least this old for an undated past date to read as a likely birth date. */
const MIN_PLAUSIBLE_AGE = 13;

const FULL_DATES: { pattern: RegExp; year: (match: RegExpExecArray) => string; valid: (match: RegExpExecArray) => boolean }[] = [
  {
    pattern: /\b(\d{1,2})([/-])(\d{1,2})\2(\d{4}|\d{2})\b|\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g,
    year: (match) => match[4] ?? match[7],
    valid: (match) => {
      const first = Number(match[1] ?? match[5]);
      const second = Number(match[3] ?? match[6]);
      return first >= 1 && second >= 1 && ((first <= 12 && second <= 31) || (second <= 12 && first <= 31));
    },
  },
  {
    pattern: /\b(\d{4})([/.-])(\d{1,2})\2(\d{1,2})\b/g,
    year: (match) => match[1],
    valid: (match) => Number(match[3]) >= 1 && Number(match[3]) <= 12 && Number(match[4]) >= 1 && Number(match[4]) <= 31,
  },
  {
    pattern: new RegExp(String.raw`\b${MONTH}\s+(\d{1,2})${ORDINAL},?\s+(\d{4})\b`, "gi"),
    year: (match) => match[2],
    valid: (match) => Number(match[1]) >= 1 && Number(match[1]) <= 31,
  },
  {
    pattern: new RegExp(String.raw`\b(\d{1,2})${ORDINAL}\s+(?:of\s+)?${MONTH},?\s+(\d{4})\b`, "gi"),
    year: (match) => match[2],
    valid: (match) => Number(match[1]) >= 1 && Number(match[1]) <= 31,
  },
];

function fullYear(raw: string, now: Date): number {
  const year = Number(raw);
  if (raw.length === 4) return year;
  const century = Math.floor(now.getFullYear() / 100) * 100;
  return year > now.getFullYear() % 100 ? century - 100 + year : century + year;
}

const datesOfBirth: Detector = (text, claims, now) => {
  for (const { pattern, year, valid } of FULL_DATES) {
    each(pattern, text, (match) => {
      if (!valid(match)) return;
      const value = fullYear(year(match), now);
      const before = text.slice(Math.max(0, match.index - 40), match.index);
      const age = now.getFullYear() - value;
      if (BIRTH_CONTEXT.test(before) || (age >= MIN_PLAUSIBLE_AGE && age <= 120)) {
        claims.add("dateOfBirth", match.index, match.index + match[0].length);
      }
    });
  }
};

/** Partial dates are only personal next to a birth word: "born in 1985", "DOB: March 3". */
const partialBirthDates = claimValue("dateOfBirth", new RegExp(
  String.raw`\b${BIRTH_WORD}\b\s*(?:is|was|on|in|of|:|-|=)?\s*(?:on|in)?\s*((?:${MONTH}\s+\d{1,2}${ORDINAL}(?:,?\s+\d{4})?)|(?:\d{1,2}${ORDINAL}\s+(?:of\s+)?${MONTH}(?:,?\s+\d{4})?)|(?:${MONTH}\s+\d{4})|(?:\d{1,2}[/.-]\d{1,2}(?:[/.-]\d{2,4})?)|(?:1[89]|20)\d{2})`,
  "gid",
));

/** Groups of digits joined by single spaces, dashes, dots or brackets, as people write phone and account numbers. */
const NUMBER_RUN = /(?<![\w.-])\+?\(?\d(?:\d|[ .-](?=\(?\d)|\)\s?(?=\d)|\((?=\d))*(?![\w])/g;

const cards: Detector = (text, claims) => each(NUMBER_RUN, text, ({ 0: value, index }) => {
  const digits = digitsOf(value);
  if (digits.length >= 13 && digits.length <= 19 && luhn(digits) && !/\(/.test(value)) {
    claims.add("card", index, index + value.length);
  }
});

const PHONE_WORD = String.raw`(?:phone|tel|telephone|cell|mobile|mob|fax|whatsapp|call|text|sms|contact)`;
const phones: Detector[] = [
  claimValue("phone", new RegExp(String.raw`\b${PHONE_WORD}\b\.?\s*(?:number|no\.?|#)?\s*(?:is|at|on|:|-)?\s*(\+?[\d(][\d\s().-]{5,}\d)`, "gid"),
    (value) => digitsOf(value).length >= 7),
  (text, claims) => each(NUMBER_RUN, text, ({ 0: value, index }) => {
    const digits = digitsOf(value);
    const international = value.startsWith("+") && digits.length >= 8 && digits.length <= 15;
    const national = /^(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}$/.test(value) && /[ .()-]/.test(value);
    if (international || national) claims.add("phone", index, index + value.length);
  }),
];

/** Nine or more digits in a row read as an account, ID or other identifying number. Round quantities are allowed. */
const longNumbers: Detector = (text, claims) => each(NUMBER_RUN, text, ({ 0: value, index }) => {
  const digits = digitsOf(value);
  if (digits.length >= 9 && !/^[1-9]\d?0{6,}$/.test(value)) claims.add("idNumber", index, index + value.length);
});

const STREET_SUFFIX = String.raw`(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Place|Pl|Terrace|Ter|Circle|Cir|Highway|Hwy|Parkway|Pkwy|Square|Sq|Trail|Trl|Crescent|Cres|Close|Alley|Plaza|Loop|Pike|Mews|Grove|Gardens)`;
const UNIT = String.raw`(?:,?\s*(?:Apt|Apartment|Suite|Ste|Unit|Flat|Room|Rm|#)\.?\s*#?\s*[A-Z0-9-]+)?`;
const US_STATES = "AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|PR";
const addresses: Detector[] = [
  claimAll("address", new RegExp(
    String.raw`\b\d{1,6}[A-Za-z]?(?:-\d{1,4})?\s+(?:[NSEW]\.?\s+|(?:North|South|East|West)\s+)?(?:[A-Z0-9][A-Za-z0-9'.-]*\s+){0,4}${STREET_SUFFIX}\b\.?${UNIT}`,
    "g",
  )),
  claimAll("address", /\bP\.?\s?O\.?\s+Box\s+\d+/gi),
  claimAll("address", /\b(?:apt|apartment|suite|flat)\.?\s*#\s*[A-Z0-9-]+|\b(?:apt|apartment)\.?\s+\d+[A-Z]?\b/gi),
  claimAll("address", /\b\d{5}-\d{4}\b/g),
  claimAll("address", new RegExp(String.raw`\b(?:${US_STATES})\s+\d{5}(?:-\d{4})?\b`, "g")),
  // UK and Canadian postcodes.
  claimAll("address", /\b(?:GIR ?0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]? ?\d[ABD-HJLNP-UW-Z]{2})\b/g),
  claimAll("address", /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d\b/g),
  claimValue("address", new RegExp(String.raw`\b(?:(?:home|mailing|street|postal|billing|shipping)\s+)?(?:address|addr)\s*(?:is|:|=|-)\s*([^.;\n]{5,80}?)(?=[.;\n]|$)`, "gid"),
    (value) => /\d/.test(value)),
  claimValue("address", new RegExp(String.raw`\b(?:lives|living|resides|residing|located)\s+(?:at|on)\s+([^.;\n]{5,80}?)(?=[,.;\n]|$)`, "gid"),
    (value) => /\d/.test(value)),
];

// Ranges and thresholds describe a cohort ("aged 18-25", "over 65"), not a person.
const COHORT_BEFORE = /(?:\b(?:over|under|above|below|older|younger|than|least|most|minimum|maximum|min|max|between|from|to|and|or|ages|aged\s+\d+\s*(?:-|to))|[<>≤≥-]|\d\s*(?:-|to|and|or))\s*$/i;
const COHORT_AFTER = /^\s*(?:\+|plus|-\s*\d|to\s+\d|and\s+(?:over|up|older|above|under|younger|below)|or\s+(?:over|older|above|more|under|younger|below|less))/i;

const AGE_PATTERNS = [
  /\b(\d{1,3})\s*-?\s*(?:years?|yrs?)\s*-?\s*old\b|\b(\d{1,3})\s*(?:y\/o|yo|y\.o\.)(?!\w)/gi,
  /\b(?:age|aged)\s*(?:is|of|:|=|-)?\s*(\d{1,3})\b/gi,
];

const ages: Detector = (text, claims) => {
  for (const pattern of AGE_PATTERNS) {
    each(pattern, text, (match) => {
      const value = Number(match[1] ?? match[2]);
      if (value > 125) return;
      const before = text.slice(Math.max(0, match.index - 20), match.index);
      const after = text.slice(match.index + match[0].length, match.index + match[0].length + 20);
      if (COHORT_BEFORE.test(before) || COHORT_AFTER.test(after)) return;
      claims.add("age", match.index, match.index + match[0].length);
    });
  }
};

/** "Maria Garcia, 34," – a capitalized name followed by a bare age. */
const namedAges = claimValue("age", new RegExp(String.raw`\b[A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)+,\s*(\d{1,3})(?=\s*[,)])`, "gd"),
  (value) => Number(value) > 0 && Number(value) <= 125);

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** Well-known organizations that read as a first and last name. Taught to compromise so it tags them as organizations. */
const ORGANIZATIONS_NAMED_LIKE_PEOPLE = [
  "morgan stanley", "grant thornton", "goldman sachs", "wells fargo", "charles schwab", "edward jones",
  "kaiser permanente", "dow jones", "ralph lauren", "tommy hilfiger", "calvin klein", "louis vuitton",
  "baker mckenzie", "hewlett packard", "john deere", "john hancock", "jp morgan", "mary kay", "estee lauder",
  "harley davidson", "rolls royce", "mercedes benz", "walt disney", "johns hopkins",
];
nlp.addWords(Object.fromEntries(ORGANIZATIONS_NAMED_LIKE_PEOPLE.map((name) => [name, "Organization"])));
const KNOWN_ORGANIZATIONS = new Set(ORGANIZATIONS_NAMED_LIKE_PEOPLE);
/** A name ending in one of these words is an organization ("Smith Holdings"). Words in NOT_A_NAME already rule a phrase out. */
const ORGANIZATION_SUFFIX = /\b(?:bank|bancorp|corp|corporation|co|company|inc|llc|llp|lp|ltd|plc|gmbh|sa|ag|healthcare|hospital|clinic|medical|university|college|school|institute|foundation|trust|partners|capital|insurance|financial|holdings|labs?|technologies|tech|solutions|consulting|associates|cloud|network|media|pharma|pharmaceuticals|motors|airlines|stores?|markets?|state|county|city)\.?$/i;

/** Words that make a capitalized phrase a thing rather than a person: "Customer Data", "Wellness Program". */
const NOT_A_NAME = new Set([
  "data", "database", "records", "record", "list", "lists", "information", "info", "profile", "profiles", "portal",
  "platform", "experience", "relationship", "relationships", "management", "service", "services", "success", "support",
  "account", "accounts", "insights", "analytics", "journey", "segment", "segments", "program", "programs", "team",
  "teams", "group", "groups", "center", "centre", "care", "health", "engagement", "lifetime", "value", "retention",
  "identity", "identities", "survey", "surveys", "feedback", "interface", "id", "ids", "number", "numbers", "base",
  "file", "files", "details", "level", "levels", "tier", "tiers", "matching", "match", "consent", "privacy", "rights",
  "request", "requests", "satisfaction", "loyalty", "acquisition", "churn", "outreach", "communications", "email",
  "emails", "phone", "address", "addresses", "names", "name", "contact", "contacts", "table", "tables", "dataset",
  "datasets", "system", "systems", "app", "application", "applications", "registry", "registration", "enrollment",
  "portfolio", "pipeline", "dashboard", "report", "reports", "agreement", "agreements", "programme", "programmes", "department", "departments", "office", "unit", "units", "project", "projects",
  "initiative", "study", "studies", "model", "models", "operations", "administration", "committee", "board",
  "council", "division", "campaign", "campaigns", "plan", "plans", "policy", "fund", "scheme", "panel", "panels",
  "pilot", "prediction", "ledger", "ledgers", "store", "stores", "ward", "clinic", "lab",
]);

const FUNCTION_WORDS = new Set(["and", "or", "the", "a", "an", "of", "for", "in", "on", "to", "with", "from", "by", "at", "is", "are", "was", "were", "will", "our", "their", "your", "my", "his", "her", "its", "this", "that", "these", "those", "we", "they", "please"]);

function isNotAName(word: string): boolean {
  const bare = bareWord(word);
  return NOT_A_NAME.has(bare) || FUNCTION_WORDS.has(bare);
}

function isOrganization(candidate: string): boolean {
  const phrase = bareWord(candidate.trim().split(/\s+/).join(" "));
  return KNOWN_ORGANIZATIONS.has(phrase) || ORGANIZATION_SUFFIX.test(phrase);
}

function looksLikeName(candidate: string): boolean {
  const words = candidate.split(/\s+/).filter(Boolean);
  return words.length > 0 && !words.some(isNotAName) && !isOrganization(candidate);
}

/** What a possessive name owns in "Jane Doe's records" or "segun's orders". */
const POSSESSED = String.raw`(?:records?|files?|data|details|account|history|chart|profile|information|info|address|email|phone|number|results?|claims?|purchases?|transactions?|application|case|diagnosis|orders?|payments?|refund|form)`;

/** Space within a line: a cue on one line never reaches a word on the next, as after a "Customer Stories" heading. */
const SP = String.raw`[^\S\n]`;
const NAME_WORD = String.raw`[A-Z][a-z]+(?:['’-][A-Za-z]+)*`;
const NAME = String.raw`${NAME_WORD}(?:${SP}+(?:[A-Z]\.${SP}+)?${NAME_WORD}){0,2}`;
const HONORIFIC = String.raw`(?:Mr|Mrs|Ms|Mx|Miss|Dr|Prof|Professor|Sir|Dame|Madam|Mme|Mlle|Herr|Frau|Sr|Sra|Srta)`;
const ROLE_WORDS = [
  "customer", "client", "patient", "member", "employee", "user", "student", "applicant", "subscriber", "resident",
  "tenant", "borrower", "cardholder", "policyholder", "donor", "participant", "consumer", "person", "individual",
  "contact", "guest", "buyer", "shopper", "lead", "prospect", "child", "parent", "mother", "father", "son", "daughter",
  "wife", "husband", "beneficiary", "claimant", "victim", "suspect", "witness", "candidate", "volunteer", "staffer",
];

type ParsedTerm = { text: string; tags: string[]; start: number; end: number };
type CompromiseTerm = { text: string; tags: string[]; offset: { start: number; length: number } };
type CompromiseJson = { terms: CompromiseTerm[] }[];
const JSON_OFFSETS = { offset: true, terms: { offset: true } };
const toParsedTerms = (json: unknown): ParsedTerm[][] => (json as CompromiseJson)
  .map(({ terms }) => terms.map(({ text, tags, offset }) => ({ text, tags, start: offset.start, end: offset.start + offset.length })));

let lastParse: { text: string; doc: ReturnType<typeof nlp>; terms: ParsedTerm[] } | undefined;

/** One compromise parse of the scanned text, shared by every name check. */
function parse(text: string): NonNullable<typeof lastParse> {
  if (lastParse?.text !== text) {
    const doc = nlp(text);
    lastParse = { text, doc, terms: toParsedTerms(doc.json(JSON_OFFSETS)).flat() };
  }
  return lastParse;
}

const NOT_NAME_TAGS = new Set(["Verb", "Adverb", "Adjective", "Determiner", "Preposition", "Conjunction", "Pronoun", "QuestionWord"]);

function isOrdinaryWord({ text, tags }: ParsedTerm): boolean {
  if (tags.includes("FirstName") || tags.includes("LastName")) return false;
  return tags.some((tag) => NOT_NAME_TAGS.has(tag)) || isKnownWord(text.replace(/[^A-Za-z'-]/g, ""));
}

/** Where the name starts past leading ordinary words ("Compare Jane Doe's"); null when all are ordinary ("Customer Stories"). */
function nameStart(text: string, start: number, end: number): number | null {
  const terms = parse(text).terms.filter((term) => term.start >= start && term.start < end);
  const index = terms.findIndex((term) => !isOrdinaryWord(term));
  if (index === -1) return null;
  return index === 0 ? start : terms[index].start;
}

function nameDetector(pattern: RegExp): Detector {
  return (text, claims) => each(pattern, text, (match) => {
    const span = match.indices?.[1];
    if (!span) return;
    const start = nameStart(text, span[0], span[1]);
    if (start !== null && looksLikeName(text.slice(start, span[1]))) claims.add("name", start, span[1]);
  });
}

const nameCues: Detector[] = [
  nameDetector(new RegExp(String.raw`\b${HONORIFIC}\.?${SP}+(${NAME})`, "gd")),
  nameDetector(new RegExp(String.raw`\b(?:${anyCaseWords(["full", "first", "last", "maiden", "given", "family"])}${SP}+)?${anyCaseWords(["name", "surname"])}${SP}*(?:is|was|:|=|-)${SP}*(${NAME})`, "gd")),
  nameDetector(new RegExp(String.raw`\b${anyCaseWords(["named", "called", String.raw`known${SP}+as`])}${SP}+(${NAME})`, "gd")),
  nameDetector(new RegExp(String.raw`\b${anyCaseWords(ROLE_WORDS)}s?${SP}*[:,]?${SP}+(${NAME})`, "gd")),
  // "Jane Doe's records", "Okafor's file".
  nameDetector(new RegExp(String.raw`\b(${NAME})['’]s\s+${POSSESSED}\b`, "gd")),
  // "Chinedu Okafor (born 1990)", "Jane Doe <jane@…>", "Kwame Mensah: 555…".
  nameDetector(new RegExp(String.raw`\b(${NAME_WORD}${SP}+${NAME_WORD})(?=\s*(?:\(|<|,\s*(?:born|dob|age|aged|\d)))`, "gd")),
];

/** Names compromise recognizes from its first-name and surname lexicon, minus places and organizations. */
const knownNames: Detector = (text, claims) => {
  const spans: [number, number][] = [];
  for (const person of toParsedTerms(parse(text).doc.people().json(JSON_OFFSETS))) {
    const tags = new Set(person.flatMap((term) => term.tags));
    if (tags.has("Place") || tags.has("Organization")) continue;
    // "Dr." stays readable; only the name itself is a finding.
    const terms = person.filter((term) => term.text.trim() && !term.tags.includes("Honorific"));
    const named = terms.some((term) => term.tags.includes("FirstName") || term.tags.includes("LastName"))
      || (terms.length > 0 && terms.length < person.length);
    if (!named) continue;
    const start = terms[0].start;
    const value = text.slice(start, terms[terms.length - 1].end).replace(/['’]s$|[.,;:!?)]+$/u, "");
    if (value.trim()) spans.push([start, start + value.length]);
  }
  // Compromise can return "Maria" and "Garcia's" as separate people; rejoin neighbours before judging the whole name.
  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const span of spans) {
    const previous = merged[merged.length - 1];
    if (previous && /^[\s-]*$/.test(text.slice(previous[1], span[0]))) previous[1] = Math.max(previous[1], span[1]);
    else merged.push([...span]);
  }
  for (const [start, end] of merged) {
    const value = text.slice(start, end);
    if (looksLikeName(value) && !value.split(/\s+/).every(isKnownOrganization) && !namesAThingInContext(text, start, end)) {
      claims.add("name", start, end);
    }
  }
};

/** A capitalized word in any script: "Adaeze", "O'Connor", "McDonald", "Siobhán", "Adebayo-Smith". */
const CAPITALIZED_WORD = /(?<![\p{L}\p{M}\p{N}'’-])\p{Lu}[\p{Ll}\p{M}]+(?:\p{Lu}[\p{Ll}\p{M}]+)?(?:['’-]\p{Lu}?[\p{Ll}\p{M}]+)*(?![\p{L}\p{M}\p{N}])/gu;
const NOT_A_PERSON_TAGS = new Set(["Organization", "Place", "Demonym", "Acronym", "Abbreviation", "Honorific", "Month", "WeekDay", "Date", "Holiday", "Currency", "Unit"]);

type Word = { start: number; end: number; unfamiliar: boolean; nameLike: boolean };

function namesAThing(run: string): boolean {
  return run.split(/\s+/).some((word) => NOT_A_NAME.has(bareWord(word)));
}

/** The joins between list items: ", ", ", and ", " or ", " & ". */
const LIST_LINK = String.raw`(?:\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or|&)\s+)`;
const CAPITALIZED_PHRASE = String.raw`\p{Lu}[\p{L}\p{M}'’-]*(?:\s+\p{Lu}[\p{L}\p{M}'’-]*)*`;

/** "in Lagos", "across Nairobi, Accra and Enugu": a list of capitalized words after a place preposition. */
const PLACE_CONTEXT = new RegExp(String.raw`\b(?:in|across|throughout|around|near|within)\s+(?:${CAPITALIZED_PHRASE}${LIST_LINK})*$`, "u");
const REST_OF_LIST = new RegExp(String.raw`^(?:${LIST_LINK}${CAPITALIZED_PHRASE})*`, "u");

/**
 * A system, not a person, is the object of these verbs when a preposition introduces it:
 * "sync with Airtable", "query them with Athena", "built on Supabase", "via Segment". "Export Maria's records" still names her.
 */
const SYSTEM_CONTEXT = /(?:\b(?:sync(?:ed|ing|s)?|integrat(?:e|ed|es|ing|ion)|quer(?:y|ied|ies|ying)|host(?:ed|ing|s)?|migrat(?:e|ed|es|ing)|deploy(?:ed|ing|s)?|ingest(?:ed|ing|s)?|stream(?:ed|ing|s)?|index(?:ed|ing)?|connect(?:ed|ing|s)?|load(?:ed|ing|s)?|export(?:ed|ing|s)?|import(?:ed|ing|s)?|upload(?:ed|ing|s)?|pipe(?:d|s)?|stor(?:e|ed|es|ing)|built|build(?:ing|s)?|run(?:s|ning)?|ran)\b[^.;!?\n]{0,40}\b(?:with|in|into|to|on|from|onto)|\b(?:using|via|powered\s+by|built\s+on|hosted\s+on))\s+$/i;

/** A noun right after a capitalized run that makes it a thing or place: "RevOps teams", "Onitsha branches". */
const THING_HEADS = new Set([
  "team", "teams", "group", "groups", "program", "programs", "programme", "platform", "app", "apps", "system", "systems",
  "portal", "service", "services", "dashboard", "dashboards", "pipeline", "pipelines", "project", "department", "office",
  "offices", "unit", "branch", "branches", "store", "stores", "clinic", "clinics", "hospital", "hospitals", "model",
  "models", "survey", "api", "apis", "sdk", "integration", "integrations", "connector", "workspace", "cluster", "bucket",
  "buckets", "database", "warehouse", "server", "servers", "instance", "plugin", "ads", "campaign", "campaigns",
  "region", "regions", "market", "markets", "site", "sites", "hub", "campus", "district", "state", "city", "area",
  "location", "locations", "depot", "tables", "events", "segments", "workflow", "workflows", "reports", "report",
  "processor", "processors", "autoscaler", "engine", "framework", "library", "console", "chip", "chips", "instances",
  "functions",
]);

const ORGANIZATION_NOUN = String.raw`(?:company|marketplace|platform|provider|startup|firm|business|retailer|brand|service|app|bank|vendor|tool|software|product|website|network|agency|manufacturer|insurer|lender|chain|organi[sz]ation)`;
/** "Company 1: Airtasker", "Vendor - Smartsheet": a label that introduces an organization. */
const ORGANIZATION_LABEL = new RegExp(String.raw`\b${ORGANIZATION_NOUN}(?:${SP}|[#\d])*[:–-]${SP}*$`, "i");
/** "Airtasker, an Australian online marketplace", "Smartsheet, a saas company": the text says what it is. */
const ORGANIZATION_APPOSITIVE = new RegExp(String.raw`^,\s+(?:a|an)\s+(?:[\p{L}-]+\s+){0,3}${ORGANIZATION_NOUN}(?=\s*(?:[,.;:)]|$)|\s+(?:that|which|based|headquartered|founded|offering|providing|serving|known|focused|specializing)\b)`, "iu");
/** The word just before a phrase is a known vendor, so the phrase is its product: "AWS Graviton", "Amazon SQS". */
const VENDOR_BEFORE = new RegExp(String.raw`(\p{Lu}\p{L}*)${SP}+$`, "u");

/** Internal capitals mark a product ("PostHog", "RevOps") unless they follow a surname prefix ("McDonald", "DeShawn"). */
const NAME_PREFIXES = new Set(["mc", "mac", "de", "la", "le", "di", "da", "van", "von", "du", "st", "fitz", "o"]);
function isCamelCaseProduct(word: string): boolean {
  const head = /^(\p{Lu}[\p{Ll}\p{M}]+)\p{Lu}/u.exec(word);
  return head !== null && !NAME_PREFIXES.has(head[1].toLowerCase());
}

function namesAThingInContext(text: string, start: number, end: number): boolean {
  if (/^['’]s\b/u.test(text.slice(end))) return false;
  const before = text.slice(Math.max(0, start - 80), start);
  // Look past the rest of a list for its head noun: "Ikeja and Lekki stores".
  const after = text.slice(end, end + 120).replace(REST_OF_LIST, "");
  const next = /^\s+(?:\([^)\n]{0,30}\)\s+)?(\p{L}+)/u.exec(after);
  return SYSTEM_CONTEXT.test(before) || PLACE_CONTEXT.test(before) || ORGANIZATION_LABEL.test(before)
    || ORGANIZATION_APPOSITIVE.test(text.slice(end, end + 80)) || isKnownOrganization(VENDOR_BEFORE.exec(before)?.[1] ?? "")
    || (next !== null && THING_HEADS.has(next[1].toLowerCase()));
}

function startsSentence(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 20), index).replace(/[ \t]+$/, "");
  return (before === "" && index <= 20) || /[.!?:;\n(\["“'‘]$/u.test(before);
}

/**
 * Names outside compromise's lexicon, such as many African, Asian and Indigenous names: a capitalized word that
 * isn't known vocabulary, together with the capitalized words beside it ("Precious Eze").
 */
const SAME_LINE_GAP = new RegExp(String.raw`^${SP}+$`);

const unfamiliarNames: Detector = (text, claims) => {
  const { terms } = parse(text);
  const words: Word[] = [...text.matchAll(CAPITALIZED_WORD)].map((match) => {
    const start = match.index;
    const end = start + match[0].replace(/['’]s$/u, "").length;
    const tags = terms.find((term) => start >= term.start && start < term.end)?.tags ?? [];
    const unfamiliar = !tags.some((tag) => NOT_A_PERSON_TAGS.has(tag)) && !isKnownWord(match[0]) && !isCamelCaseProduct(match[0]);
    return { start, end, unfamiliar, nameLike: unfamiliar || tags.includes("FirstName") || tags.includes("LastName") };
  });
  const runs: Word[][] = [];
  for (const word of words) {
    const run = runs[runs.length - 1];
    const previous = run?.[run.length - 1];
    if (previous && SAME_LINE_GAP.test(text.slice(previous.end, word.start).replace(/^['’]s/u, ""))) run.push(word);
    else runs.push([word]);
  }
  const wordOf = (word: Word) => text.slice(word.start, word.end).toLowerCase();
  const isThing = (run: Word[]) => {
    const whole = text.slice(run[0].start, run[run.length - 1].end);
    return isOrganization(whole) || namesAThing(whole) || namesAThingInContext(text, run[0].start, run[run.length - 1].end);
  };
  const thingRuns = new Set(runs.filter((run) => run.some((word) => word.unfamiliar) && isThing(run)));
  // A word shown to be a brand or place once ("Company 1: Airtasker") is one at every mention.
  const things = new Set([...thingRuns].flatMap((run) => run.filter((word) => word.unfamiliar).map(wordOf)));
  for (const words of runs) {
    if (thingRuns.has(words) || words.every((word) => !word.unfamiliar || things.has(wordOf(word)))) continue;
    let first = words.findIndex((word) => word.nameLike);
    const last = words.findLastIndex((word) => word.nameLike);
    // Take in capitalized words before the name unless they open the sentence: "Precious Eze", but not "Contact Ananya".
    while (first > 0) {
      const before = words[first - 1];
      if (isNotAName(text.slice(before.start, before.end)) || startsSentence(text, before.start)) break;
      first -= 1;
    }
    const [start, end] = [words[first].start, words[last].end];
    if (looksLikeName(text.slice(start, end))) claims.add("name", start, end);
  }
};

const LOWER_WORD = String.raw`[\p{Ll}][\p{L}\p{M}'’-]+`;

/** Claims the leading words of a captured phrase that are not English: "segun" in "belongs to segun now". */
function claimUnfamiliarWords(text: string, claims: Claims, start: number, phrase: string): void {
  let end = start;
  for (const token of phrase.matchAll(/\S+/gu)) {
    if (isKnownWord(token[0])) break;
    end = start + token.index + token[0].replace(/['’]s$/u, "").length;
  }
  claims.add("name", start, end);
}

/**
 * Lower-case names right after a strong cue: "my wife adaeze", "name is tunde bakare", "I'm chidinma".
 * The name is captured in a lookahead so a cue that finds no name ("husband, my wife ngozi") doesn't swallow the next cue.
 */
const LOWERCASE_NAME_CUE = new RegExp(
  String.raw`(?:\b(?:(?:my|his|her|their|our|the)${SP}+)?${anyCaseWords(ROLE_WORDS)}|\b${anyCaseWords(["name", "surname"])}${SP}*(?:is|was|:)|\b${anyCaseWords(["named", "called"])}|\b[Ii]${SP}+am|\b[Ii]['’]m)${SP}*[:,]?${SP}+(?=([\p{Ll}][\p{L}\p{M}'’-]*(?:${SP}+[\p{Ll}][\p{L}\p{M}'’-]*){0,2}))`,
  "gdu",
);

/** Positions that take a person: "send it to okeke", "ask chiamaka", "submitted by uchenna", "Mr. adewale". */
const PERSON_POSITION = new RegExp(
  String.raw`(?:\b(?:send|give|forward|email|mail|pass|hand|assign|show|sell|pay|refund|transfer|deliver|report|write|reply|sent|gave|given|forwarded|emailed|mailed|handed|assigned|showed|shown|sold|paid|refunded|transferred|delivered|reported|wrote|written|replied|belongs?|belonged)\b(?:${SP}+[\p{L}'’-]+){0,3}?${SP}+to|\b(?:ask|asked|email|emailed|call|called|phone|phoned|text|texted|tell|told|notify|notified|remind|reminded|ping|pinged|message|messaged|thank|thanked|cc|bcc|contact|contacted|invite|invited|meet|met|visit|visited|hire|hired|bill|billed|charge|charged|refund|refunded|pay|paid|credit|credited|reimburse|reimbursed|compensate|compensated|treat|treated|admit|admitted|discharge|discharged)|\b(?:submitted|approved|requested|signed|sent|owned|created|filed|made|written|reviewed|authori[sz]ed|referred|prescribed|completed|initiated|raised|opened|closed|placed|booked)${SP}+by|\bon${SP}+behalf${SP}+of|\b${HONORIFIC}\.?)${SP}+(?=(${LOWER_WORD}(?:${SP}+${LOWER_WORD})?))`,
  "gdu",
);

/** "segun's records": a possessive non-English word before something personal. */
const LOWERCASE_POSSESSIVE = new RegExp(
  String.raw`(?<![\p{L}\p{M}])(?=([\p{Ll}][\p{L}\p{M}-]{2,})['’]s\s+${POSSESSED}\b)`,
  "gdu",
);

/** Two or more non-English lower-case words together are almost always a name ("adaeze okeke"), not a typo. */
const LOWERCASE_PAIR = new RegExp(String.raw`(?<![\p{L}\p{M}'’-])${LOWER_WORD}(?:\s+${LOWER_WORD})+(?![\p{L}\p{M}])`, "gu");

const lowercaseNames: Detector = (text, claims) => {
  for (const pattern of [LOWERCASE_NAME_CUE, PERSON_POSITION, LOWERCASE_POSSESSIVE]) {
    each(pattern, text, (match) => {
      const span = match.indices?.[1];
      if (span) claimUnfamiliarWords(text, claims, span[0], match[1]);
    });
  }
  each(LOWERCASE_PAIR, text, (match) => {
    let runStart = -1;
    let runEnd = -1;
    let count = 0;
    const flush = () => {
      if (count >= 2) claims.add("name", runStart, runEnd);
      count = 0;
    };
    for (const token of match[0].matchAll(/\S+/gu)) {
      const start = match.index + token.index;
      if (token[0].length >= 3 && !isKnownWord(token[0])) {
        if (count === 0) runStart = start;
        runEnd = start + token[0].length;
        count += 1;
      } else flush();
    }
    flush();
  });
};

/** A line's fields if it reads as a table row: two or more, of at most four words each. Prose with commas is not a row. */
function rowFields(line: string, separator: RegExp): string[] | null {
  const fields = line.split(separator);
  return fields.length >= 2 && fields.every((field) => field.trim().split(/\s+/).length <= 4) ? fields : null;
}

/** Rows of a pasted table: any field with a non-English word in it ("obinna eze;nkem obi"). */
const tabularNames: Detector = (text, claims) => {
  const lines = text.split("\n");
  const commaRows = lines.map((line) => rowFields(line, /,/));
  const commaTable = commaRows.filter(Boolean).length >= 2;
  let offset = 0;
  lines.forEach((line, index) => {
    let fieldStart = offset;
    for (const field of rowFields(line, /[;\t|]/) ?? (commaTable ? commaRows[index] : null) ?? []) {
      const trimmed = field.trim();
      const lead = field.length - field.trimStart().length;
      if (/^[\p{L}\p{M}'’ .-]+$/u.test(trimmed)
        && trimmed.split(/\s+/).some((word) => word.length >= 2 && !isKnownWord(word.replace(/\.$/, "")))) {
        claims.add("name", fieldStart + lead, fieldStart + lead + trimmed.length);
      }
      fieldStart += field.length + 1;
    }
    offset += line.length + 1;
  });
};

/** "Chidinma, segun and ngozi": non-English words listed alongside a name are names too. */
const NEXT_IN_LIST = new RegExp(String.raw`^${LIST_LINK}([\p{L}][\p{L}\p{M}'’-]*)`, "u");
const PREVIOUS_IN_LIST = new RegExp(String.raw`([\p{L}][\p{L}\p{M}'’-]*)${LIST_LINK}$`, "u");
const nameLists: Detector = (text, claims) => {
  const queue = claims.found.filter((item) => item.kind === "name").map(({ start, end }) => [start, end]);
  const claimWord = (word: string | undefined, from: number) => {
    if (!word || isKnownWord(word) || claims.overlaps(from, from + word.length)) return;
    claims.add("name", from, from + word.length);
    queue.push([from, from + word.length]);
  };
  while (queue.length) {
    const [start, end] = queue.pop()!;
    const next = NEXT_IN_LIST.exec(text.slice(end, end + 60));
    if (next) claimWord(next[1], end + next[0].length - next[1].length);
    const previous = PREVIOUS_IN_LIST.exec(text.slice(Math.max(0, start - 60), start));
    if (previous) claimWord(previous[1], start - previous[0].length);
  }
};

/** Words in scripts without capital letters (Chinese, Arabic, Hindi, Korean, Amharic…) can't be checked against English. */
const caselessScriptWords = claimAll("name", /(?:(?![ªº])\p{Lo})(?:(?![ªº])[\p{Lo}\p{M}])*/gu);

/** @handles on social platforms; email addresses are claimed first. */
const handles = claimAll("handle", /(?<![\w@.])@[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?(?![\w@])/g);

const DETECTORS: Detector[] = [
  ...SECRET_FORMATS.map((pattern) => claimAll("secret", pattern)),
  ...emails,
  handles,
  labelledSecret,
  ...deviceIds,
  ...ipAddresses,
  ...bankAccounts,
  ...governmentIds,
  datesOfBirth,
  partialBirthDates,
  ...addresses,
  labelledIds,
  cards,
  ...phones,
  longNumbers,
  ages,
  namedAges,
  // The lexicon's exact spans first; cue patterns then catch names it doesn't know.
  knownNames,
  ...nameCues,
  unfamiliarNames,
  lowercaseNames,
  tabularNames,
  caselessScriptWords,
  nameLists,
  // Long random-looking strings: keys, tokens, hashes of identifiers.
  claimAll("secret", /(?<![\w/+=-])(?=[A-Za-z0-9+/=_-]*\d[A-Za-z0-9+/=_-]*\d)(?=[A-Za-z0-9+/=_-]*[A-Za-z][A-Za-z0-9+/=_-]*[A-Za-z])[A-Za-z0-9+/=_-]{24,}(?![\w/+=-])/g),
];

/**
 * Rewrites runs of two or more ALL-CAPS words ("CHARLES OKAFOR, 12 ELM STREET") in title case so the name and
 * address checks see them as they would mixed-case text. Single acronyms such as HIPAA are left alone.
 * Only same-length case changes are made, so offsets still line up with the source.
 */
function titleCaseShouting(text: string): string {
  return text.replace(/(?<![\p{L}\p{N}])\p{Lu}{2,}(?:[ \t]+\p{Lu}{2,})+(?![\p{L}\p{N}])/gu, (run) => run.replace(
    /\p{Lu}+/gu,
    (word) => {
      const titled = word[0] + word.slice(1).toLowerCase();
      return titled.length === word.length ? titled : word;
    },
  ));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Every personal or confidential value in the text, as non-overlapping ranges of the original string. */
export function findSensitiveData(source: string, now: Date = new Date()): SensitiveFinding[] {
  if (!source.trim()) return [];
  const normalized = normalize(source.slice(0, MAX_SCAN_LENGTH));
  const text = titleCaseShouting(normalized.text);
  const claims = new Claims();
  for (const detect of DETECTORS) detect(text, claims, now);
  return claims.found
    .map(({ kind, start, end }) => ({ kind, start: normalized.starts[start], end: normalized.ends[end - 1] }))
    .sort((a, b) => a.start - b.start);
}

export function containsSensitiveData(source: string, now?: Date): boolean {
  return findSensitiveData(source, now).length > 0;
}

/** One scan: the findings, and the text with each replaced by a placeholder such as "[email]". */
export function scanSensitiveData(source: string, now?: Date): { findings: SensitiveFinding[]; redacted: string } {
  const findings = findSensitiveData(source, now);
  let redacted = source.slice(0, MAX_SCAN_LENGTH);
  for (let index = findings.length - 1; index >= 0; index -= 1) {
    const { kind, start, end } = findings[index];
    redacted = redacted.slice(0, start) + KIND_DETAILS[kind].placeholder + redacted.slice(end);
  }
  return { findings, redacted };
}

export function redactSensitiveData(source: string, now?: Date): string {
  return scanSensitiveData(source, now).redacted;
}

/** "an email address, a phone number and a date of birth" — the kinds found, never the values. */
export function describeSensitiveFindings(findings: SensitiveFinding[]): string {
  const labels = [...new Set(findings.map(({ kind }) => KIND_DETAILS[kind].label))];
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}
