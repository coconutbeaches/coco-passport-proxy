const crypto = require('crypto');
const { parse } = require('csv-parse/sync');
const { CSV_TO_DB_MAPPING, DEFAULT_RECORD_VALUES } = require('./lib/tokeetFieldMap');
const { ImageAnnotatorClient } = require('@google-cloud/vision');
const busboy = require('busboy');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Base URL configuration with runtime safety check
const PUBLIC_PASSPORT_PROXY_URL = 'https://coco-passport-proxy.vercel.app';

/**
 * Validates and returns the base URL for the passport proxy service
 * Performs safety checks for vercel.app domains to prevent TestFlight build drift
 * @returns {string} Valid base URL for the passport proxy service
 */
function validateAndGetBaseUrl() {
  // Allow environment override, but default to public URL
  const configuredUrl = process.env.PASSPORT_PROXY_BASE_URL || PUBLIC_PASSPORT_PROXY_URL;
  
  try {
    const url = new URL(configuredUrl);
    
    // Safety check: if using vercel.app domain, ensure it's the correct subdomain
    if (url.hostname.endsWith('.vercel.app') && url.hostname !== 'coco-passport-proxy.vercel.app') {
      console.error(
        `[SAFETY CHECK] Configured base URL '${configuredUrl}' uses vercel.app domain ` +
        `with incorrect subdomain '${url.hostname}'. This could be a TestFlight build drift. ` +
        `Falling back to public URL: ${PUBLIC_PASSPORT_PROXY_URL}`
      );
      return PUBLIC_PASSPORT_PROXY_URL;
    }
    
    return configuredUrl;
  } catch (error) {
    console.error(
      `[SAFETY CHECK] Invalid base URL '${configuredUrl}': ${error.message}. ` +
      `Falling back to public URL: ${PUBLIC_PASSPORT_PROXY_URL}`
    );
    return PUBLIC_PASSPORT_PROXY_URL;
  }
}

// Base URL constant for the passport proxy service (with safety check applied)
const PASSPORT_PROXY_BASE_URL = validateAndGetBaseUrl();

// --- tiny helpers ------------------------------------------------------------
/**
 * Parses JSON request body from Node.js request stream
 * @param {import('http').IncomingMessage} req - The HTTP request object
 * @returns {Promise<Object>} Promise resolving to parsed JSON object or empty object
 */
const parseBody = (req) => new Promise((resolve, reject) => {
  let data = ''; req.on('data', c => data += c);
  req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  req.on('error', reject);
});
/**
 * Fetches URL and attempts to parse response as JSON
 * @param {string} url - The URL to fetch
 * @param {Object} [opts={}] - Fetch options
 * @returns {Promise<{ok: boolean, status: number, json: Object|null, text: string}>} Response object
 */
async function fetchJson(url, opts={}) {
  const r = await fetch(url, opts);
  const text = await r.text();
  try { return { ok: r.ok, status: r.status, json: JSON.parse(text), text }; }
  catch { return { ok: r.ok, status: r.status, json: null, text }; }
}
/**
 * Sets CORS headers and handles OPTIONS preflight requests
 * @param {import('http').IncomingMessage} req - HTTP request object
 * @param {import('http').ServerResponse} res - HTTP response object
 * @returns {boolean} True if OPTIONS request was handled, false otherwise
 */
function sendCORS(req, res) {
  // Tighten CORS for production - allow specific Coco origins
  const allowedOrigins = [
    'https://coco-passport-proxy.vercel.app',
    'https://coconutbeaches.com',
    'https://app.coconutbeaches.com',
    'http://localhost:3000', // For development
    'http://localhost:8080'
  ];
  
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin) || !origin) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey, Accept-Profile, Content-Profile');
  res.setHeader('Access-Control-Max-Age', '86400'); // Cache preflight for 24 hours
  
  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return true; }
  return false;
}
/**
 * Pads single digit numbers with leading zero
 * @param {number} n - Number to pad
 * @returns {string} Padded number as string
 */
function pad(n){return n<10?'0'+n:String(n)}

/**
 * Formats date according to simple template format
 * @param {Date} d - Date to format
 * @param {string} fmt - Format string with %m, %d, %Y placeholders
 * @returns {string} Formatted date string
 */
function fmtDate(d, fmt){ return fmt.replace('%m', pad(d.getMonth()+1)).replace('%d', pad(d.getDate())).replace('%Y', d.getFullYear()) }

/**
 * Resolves date template placeholders in URL strings
 * Replaces {start:%format} and {end:%format} with tomorrow's date in UTC
 * @param {string} urlStr - URL string potentially containing date templates
 * @returns {string} URL with resolved date templates
 */
function resolveTemplateDates(urlStr){
  try{
    const now = new Date();
    const tmr = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()+1)); // "tomorrow" UTC
    return urlStr
      .replace(/{start:%([^}]+)}/g, (_,fmt)=>fmtDate(tmr, '%'+fmt))
      .replace(/{end:%([^}]+)}/g,   (_,fmt)=>fmtDate(tmr, '%'+fmt));
  }catch{ return urlStr }
}

// --- Passport OCR helper functions -------------------------------------------
function titleCase(s){ return s ? s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : s; }

/**
 * Creates Google Vision client with inline credentials for Vercel environment
 * Falls back to default credentials if GOOGLE_APPLICATION_CREDENTIALS is a file path
 */
function createVisionClient() {
  const credsEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  
  if (!credsEnv) {
    // No credentials set, use default (will fail gracefully)
    return new ImageAnnotatorClient();
  }
  
  // Check if it's JSON string or file path
  try {
    const credsObj = JSON.parse(credsEnv);
    // It's JSON - use inline credentials
    return new ImageAnnotatorClient({ credentials: credsObj });
  } catch (e) {
    // It's a file path - use default behavior
    return new ImageAnnotatorClient();
  }
}

// ================== TSV INSERT HELPERS (drop near top of index.js) ==================
function nullIfEmpty(v) {
  const s = v == null ? '' : String(v).trim();
  return s === '' ? null : s;
}

// Normalize "male/female/m/f/nb/other" etc. to single char M/F/X
function normGender(input) {
  const g = String(input || '').trim().toUpperCase();
  if (g === 'M' || g === 'MALE') return 'M';
  if (g === 'F' || g === 'FEMALE') return 'F';
  if (g === 'X' || g === 'OTHER' || g === 'NONBINARY' || g === 'NB') return 'X';
  return g.slice(0, 1) || null;
}

// Convert DD/MM/YYYY or "Sept 11" to YYYY-MM-DD in Asia/Bangkok
function toYMD(input, tz = 'Asia/Bangkok') {
  if (!input) return null;
  const s = String(input).trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) {
    const [_, dd, mm, yyyy] = m;
    return `${yyyy}-${mm}-${dd}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
  }
  return null;
}

// Strict validation for production
function validateGuestRow(guest, rowIndex) {
  const errors = [];
  
  // Gender must be exactly M, F, or X (but allow null)
  if (guest.gender && !['M', 'F', 'X'].includes(guest.gender)) {
    errors.push(`Invalid gender '${guest.gender}' at row ${rowIndex}`);
  }
  
  // Nationality must be exactly 3 A-Z characters (but allow null)
  if (guest.nationality_alpha3 && !/^[A-Z]{3}$/.test(guest.nationality_alpha3)) {
    errors.push(`Invalid nationality_alpha3 '${guest.nationality_alpha3}' at row ${rowIndex}`);
  }
  
  // Dates must be YYYY-MM-DD format or null
  if (guest.birthday && !/^\d{4}-\d{2}-\d{2}$/.test(guest.birthday)) {
    errors.push(`Invalid birthday format '${guest.birthday}' at row ${rowIndex}`);
  }
  if (guest.check_out_date && !/^\d{4}-\d{2}-\d{2}$/.test(guest.check_out_date)) {
    errors.push(`Invalid check_out_date format '${guest.check_out_date}' at row ${rowIndex}`);
  }
  
  return errors;
}

// Structured logging helper
function logTSVOperation(operation, data) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    op: operation,
    ...data
  };
  console.log(JSON.stringify(logEntry));
}

async function insertGuestsFromTSV({ stay_id, default_checkout, guests_tsv }) {
  const startTime = Date.now();
  const rows = [];
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); // YYYY-MM-DD
  const fallbackCheckout = toYMD(default_checkout);

  const badRows = [];
  const lines = String(guests_tsv || '').split(/\r?\n/).filter(l => l.trim());
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const parts = rawLine.split('\t');

    // STRICT: must be exactly 8 columns
    if (parts.length !== 8) {
      badRows.push(i); // zero-based index
      continue;
    }

    let [
      first_name,
      middle_name,
      last_name,
      gender,
      passport_number,
      nationality,
      birthday,
      checkout_date
    ] = parts;

    const nationality_alpha3 = (nationality || '').trim().toUpperCase().slice(0, 3);
    const natValid = /^[A-Z]{3}$/.test(nationality_alpha3);

    const g = normGender(gender);
    const bday = toYMD(birthday);
    const outCheckout = toYMD(checkout_date) || fallbackCheckout;

    // STRICT: validate required pieces; mark row bad if they fail
    if (!first_name?.trim() || !last_name?.trim() || !passport_number?.trim()
        || !natValid || !g || !outCheckout) {
      badRows.push(i);
      continue;
    }

    rows.push({
      stay_id: nullIfEmpty(stay_id),
      first_name: nullIfEmpty(first_name),
      middle_name: nullIfEmpty(middle_name),
      last_name: nullIfEmpty(last_name),
      gender: g,
      passport_number: nullIfEmpty(passport_number),
      nationality_alpha3,
      issuing_country_alpha3: nationality_alpha3,
      birthday: bday,
      check_in_date: today,
      check_out_date: outCheckout,
      photo_urls: []
    });
  }

  // Count countries for observability
  const countryCounts = rows.reduce((acc, row) => {
    if (row.nationality_alpha3) {
      acc[row.nationality_alpha3] = (acc[row.nationality_alpha3] || 0) + 1;
    }
    return acc;
  }, {});

  if (!rows.length) {
    logTSVOperation('tsv_validation_failed', {
      stay_id,
      total_lines: lines.length,
      bad_rows: badRows,
      latency_ms: Date.now() - startTime
    });
    
    return { insertedCount: 0, badRows };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env || {};
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE environment variables');
  }

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Accept-Profile': 'public',
      'Content-Profile': 'public',
      // enable dedupe behavior just like your working curl
      Prefer: 'return=representation,resolution=merge-duplicates'
    },
    body: JSON.stringify(rows)
  });

  if (!resp.ok) {
    const txt = await resp.text();
    logTSVOperation('tsv_insert_failed', {
      stay_id,
      total_rows: rows.length,
      supabase_status: resp.status,
      bad_rows: badRows.length > 0 ? badRows : undefined,
      latency_ms: Date.now() - startTime
    });
    throw new Error(`Supabase insert failed: ${resp.status} ${txt}`);
  }

  const inserted = await resp.json();
  const insertedCount = Array.isArray(inserted) ? inserted.length : rows.length;
  
  logTSVOperation('tsv_insert_success', {
    stay_id,
    total_rows: rows.length,
    inserted: insertedCount,
    country_counts: countryCounts,
    bad_rows: badRows.length > 0 ? badRows : undefined,
    latency_ms: Date.now() - startTime
  });
  
  return { insertedCount, badRows };
}
// ================== /helpers ==================

function formatDDMMYYYY(s){
  const m = String(s || '').trim().match(/^(\d{2})[\/.\- ](\d{2})[\/.\- ](\d{4})$/);
  return m ? `${m[1].padStart(2,'0')}/${m[2].padStart(2,'0')}/${m[3]}` : '';
}

function parseVIZ(text){
  const up = (text || '').toUpperCase();
  const pull = (...rxs) => { for (const rx of rxs){ const m = up.match(rx); if (m) return m[1].trim(); } return null; };

  const last = pull(/SURNAME[:\s]*([A-Z \-']+)/, /NAAM[:\s]*([A-Z \-']+)/, /APELLIDOS?[:\s]*([A-Z \-']+)/);
  const given = pull(/GIVEN NAMES?[:\s]*([A-Z \-']+)/, /VOORNAMEN[:\s]*([A-Z \-']+)/, /NOMBRES?[:\s]*([A-Z \-']+)/);
  const number = pull(/(?:DOCUMENT|PASSPORT)\s?NO\.?[:\s]*([A-Z0-9]+)/, /DOCUMENTNR[:\s]*([A-Z0-9]+)/);
  const nat = pull(/NATIONALITY[:\s]*([A-Z \-]+)/, /NATIONALITE[TÉ]?\s*[:\s]*([A-Z \-]+)/, /NATIONALITEIT[:\s]*([A-Z \-]+)/);
  const dob = pull(/DATE OF BIRTH[:\s]*([0-9./\- ]+)/, /GEBOORTEDATUM[:\s]*([0-9./\- ]+)/, /FECHA DE NAC[:\s]*([0-9./\- ]+)/);
  const sex = pull(/SEX[:\s]*([MFX])/, /GESLACHT[:\s]*([MVX])/, /SEXE[:\s]*([MFX])/);

  const natAlpha3 = t => {
    if (!t) return '';
    const T = t.replace(/[^A-Z ]/g,'').trim();
    if (/\bNLD\b|NETHERLANDS|NEDERLAND|PAYS BAS|PAYS-BAS/.test(T)) return 'NLD';
    const m = T.match(/\b[A-Z]{3}\b/);
    return m ? m[0] : '';
  };

  const parts = (given || '').split(/[ ,]+/).filter(Boolean);
  const first = titleCase(parts[0] || '');
  const middle = parts.length > 1 ? titleCase(parts.slice(1).join(' ')) : '';

  return {
    first_name: first,
    middle_name: middle,
    last_name: titleCase(last || ''),
    gender: sex ? sex[0].toUpperCase() : '',
    passport_number: number ? number.replace(/\s+/g,'') : '',
    nationality_alpha3: natAlpha3(nat),
    birthday: formatDDMMYYYY(dob || '') || ''
  };
}

function parseMultipart(req){
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: req.headers });
    const files = [];
    let default_checkout = null;

    bb.on('file', (_, file) => {
      const chunks = [];
      file.on('data', d => chunks.push(d));
      file.on('end', () => files.push(Buffer.concat(chunks)));
    });
    bb.on('field', (name, val) => {
      if (name === 'default_checkout') default_checkout = val;
    });
    bb.on('finish', () => resolve({ files, default_checkout }));
    bb.on('error', reject);
    req.pipe(bb);
  });
}

// CSV to DB field mapping now imported from centralized lib/tokeetFieldMap.js

/**
 * Coerces string values to specific types with fallback to null on empty/invalid values
 * @param {any} value - The value to coerce
 * @param {string} type - Target type: 'integer', 'numeric', 'date', 'time', 'array', or 'string'
 * @returns {any|null} Coerced value or null if coercion fails
 */
function coerceValue(value, type) {
  if (!value || value === '' || value === 'null' || value === 'undefined') {
    return null;
  }
  
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  
  switch (type) {
    case 'integer':
      const intVal = Number(trimmed);
      return Number.isInteger(intVal) ? intVal : null;
    
    case 'numeric':
      const numVal = parseFloat(trimmed);
      return !isNaN(numVal) && isFinite(numVal) ? numVal : null;
    
    case 'date':
      try {
        const dateVal = new Date(trimmed);
        return !isNaN(dateVal.getTime()) ? dateVal.toISOString().split('T')[0] : null;
      } catch {
        return null;
      }
    
    case 'time':
      // Handle time format like "15:00" or "12:00"
      if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
        return trimmed;
      }
      return null;
    
    case 'array':
      // Handle comma-separated values or JSON arrays
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const parsed = JSON.parse(trimmed);
          return Array.isArray(parsed) ? parsed.filter(Boolean) : null;
        } catch {
          return null;
        }
      }
      return trimmed.split(',').map(s => s.trim()).filter(Boolean);
    
    case 'string':
    default:
      // Preserve original strings for ambiguous cases (phone, email, currency)
      return trimmed;
  }
}

/**
 * Parses a CSV row into a database-compatible object using field mappings
 * Applies type coercion, generates derived fields, and sets default values
 * @param {string[]} csvRow - Array of CSV field values
 * @param {string[]} headers - Array of CSV column headers
 * @returns {Object} Database-compatible object with all mapped fields
 */
function parseCSVRowToDBObject(csvRow, headers) {
  const dbObject = {
    ...DEFAULT_RECORD_VALUES,
    raw_json: csvRow // Store original CSV row as JSON
  };
  
  // Process each CSV field
  headers.forEach((header, index) => {
    const mapping = CSV_TO_DB_MAPPING[header];
    if (!mapping || !mapping.dbField) return; // Skip unmapped fields
    
    const rawValue = csvRow[index];
    const coercedValue = coerceValue(rawValue, mapping.parser);
    dbObject[mapping.dbField] = coercedValue;
  });
  
  // Special processing for Name field (split into first_name/last_name)
  if (dbObject.name_full) {
    const nameParts = dbObject.name_full.split(' ').filter(Boolean);
    dbObject.first_name = nameParts[0] || null;
    dbObject.last_name = nameParts.slice(1).join(' ') || nameParts[0] || null; // If only one name, use it as last name too
    
    // Extract middle_name if there are 3+ parts
    if (nameParts.length >= 3) {
      dbObject.middle_name = nameParts.slice(1, -1).join(' ');
      dbObject.last_name = nameParts[nameParts.length - 1];
    }
  }
  
  // Generate rental_units array from rental_unit field
  if (dbObject.rental_unit) {
    const roomMatches = dbObject.rental_unit.match(/\(([AB]\d+)\)/g) || 
                       dbObject.rental_unit.match(/^([AB]\d+)/g) ||
                       dbObject.rental_unit.match(/(Beach House|Jungle House|Double House|New House)/g) || [];
    dbObject.rental_units = roomMatches.map(match => match.replace(/[()]/g, ''));
  }
  
  // Generate stay_id using existing logic
  if (dbObject.rental_unit && dbObject.last_name) {
    const label = `${dbObject.rental_unit} ${dbObject.last_name}`;
    const normalized = normalizeStayIdFreeform(label);
    dbObject.stay_id = normalized.stay_id;
  }
  
  // Set external_reservation_id from booking_id or inquiry_id
  if (!dbObject.external_reservation_id) {
    dbObject.external_reservation_id = dbObject.booking_id || dbObject.inquiry_id || null;
  }
  
  // Clean up temporary fields
  delete dbObject.name_full;
  
  return dbObject;
}

// Resolver bits - Stay ID generation constants and functions
const ROOM_ORDER = ["A3","A4","A5","A6","A7","A8","A9","B6","B7","B8","B9","Double House","Jungle House","Beach House","New House"];
const TWO_WORD_ROOMS = ["Double House","Jungle House","Beach House","New House"];
const ONE_WORD_ROOMS = ["A3","A4","A5","A6","A7","A8","A9","B6","B7","B8","B9"];

/**
 * Capitalizes first letter and lowercases the rest
 * @param {string} s - String to capitalize
 * @returns {string} Capitalized string
 */
function cap1(s){ if(!s) return s; return s[0].toUpperCase()+s.slice(1).toLowerCase(); }

/**
 * Validates and extracts data from MRZ (Machine Readable Zone) string
 * @param {string} mrzString - The raw MRZ string from passport OCR
 * @returns {Object} Parsed MRZ data with validation results
 */
function parseMRZ(mrzString) {
  if (!mrzString || typeof mrzString !== 'string') {
    return { valid: false, error: 'Invalid MRZ string' };
  }
  
  // Preserve newlines but normalize other whitespace - critical for format detection
  const mrz = mrzString.trim().replace(/[ \t\r]+/g, '');
  
  // Basic MRZ validation patterns
  const mrzPatterns = {
    // TD1 (3 line format) - ID cards
    td1: /^[A-Z0-9<]{30}\n?[A-Z0-9<]{30}\n?[A-Z0-9<]{30}$/,
    // TD3 (2 line format) - Passports
    td3: /^P<[A-Z]{3}[A-Z<]{25,39}\n?[A-Z0-9<]{44}$/,
    // Simple passport pattern
    passport: /^P<[A-Z]{3}/
  };
  
  let format = 'unknown';
  if (mrzPatterns.td3.test(mrz)) format = 'TD3';
  else if (mrzPatterns.td1.test(mrz)) format = 'TD1';
  else if (mrzPatterns.passport.test(mrz)) format = 'passport';
  
  // Extract basic passport info for TD3 format
  if (format === 'TD3' || format === 'passport') {
    try {
      const lines = mrz.split('\n').filter(Boolean);
      if (lines.length >= 1) {
        const line1 = lines[0] || mrz.substring(0, Math.min(44, mrz.length));
        
        // Extract country code (positions 2-4)
        const issuingCountry = line1.substring(2, 5).replace(/</g, '');
        
        // Extract name section (positions 5+) - parse BEFORE replacing < with spaces
        const rawNameSection = line1.substring(5);
        
        // For passports, the format is LASTNAME<<FIRSTNAME
        // Split by << first, then clean up each part
        const fullNameParts = rawNameSection.split('<<').map(part => part.replace(/</g, ' ').trim());
        const lastName = fullNameParts[0] || null;
        const firstName = fullNameParts[1] || null;
        
        // Also create the cleaned version for backward compatibility
        const nameSection = rawNameSection.replace(/</g, ' ').trim();
        const nameParts = nameSection.split(/\s+/).filter(Boolean);
        // Extract passport number, gender and birthdate from second line if available (TD3 format)
        let passportNumber = null;
        let gender = null;
        let birthdate = null;
        let expiryDate = null;
        if (lines.length >= 2) {
          const line2 = lines[1];
          if (line2 && line2.length >= 28) {
            // TD3 format has variable passport number length (up to 9 chars)
            // Find where passport number ends (first < or position 9)
            let passportEndPos = 9;
            for (let i = 0; i < 9; i++) {
              if (line2.charAt(i) === '<') {
                passportEndPos = i;
                break;
              }
            }
            passportNumber = line2.substring(0, passportEndPos).trim();
            
            // After passport number (9 chars allocated), there's 1 check digit
            // Then nationality code (3 chars) at positions 10-12
            // But we need to account for actual passport length
            const dataStartPos = 10; // Start of nationality
            
            // For standard TD3, positions are:
            // 0-8: Passport number (9 chars allocated)
            // 9: Check digit
            // 10-12: Nationality (3 chars)
            // 13-18: Birth date (6 chars)
            // 19: Check digit
            // 20: Gender (1 char)
            // 21-26: Expiry date (6 chars)
            // 27: Check digit
            
            // However, if line is shorter than standard, adjust positions
            const lineLength = line2.length;
            const isShortLine = lineLength < 44;
            const offset = isShortLine ? 44 - lineLength : 0;
            
            // Extract birthdate (adjusted for short lines)
            const birthdatePos = 13 - offset;
            if (lineLength >= birthdatePos + 6) {
              const birthdateStr = line2.substring(birthdatePos, birthdatePos + 6);
              if (/^\d{6}$/.test(birthdateStr)) {
                const year = parseInt(birthdateStr.substring(0, 2));
                const month = parseInt(birthdateStr.substring(2, 4));
                const day = parseInt(birthdateStr.substring(4, 6));
                
                // Convert 2-digit year to 4-digit (assume 20xx for years 00-30, 19xx for 31-99)
                const fullYear = year <= 30 ? 2000 + year : 1900 + year;
                
                // Validate date components
                if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                  // Format as YYYY-MM-DD
                  birthdate = `${fullYear}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
                }
              }
            }
            
            // Extract gender (adjusted for short lines)
            const genderPos = 20 - offset;
            if (lineLength > genderPos) {
              const genderChar = line2.charAt(genderPos);
              if (genderChar === 'M' || genderChar === 'F' || genderChar === 'X') {
                gender = genderChar;
              }
            }
            
            // Extract expiry date (adjusted for short lines)
            const expiryPos = 21 - offset;
            if (lineLength >= expiryPos + 6) {
              const expiryStr = line2.substring(expiryPos, expiryPos + 6);
              if (/^\d{6}$/.test(expiryStr)) {
                const year = parseInt(expiryStr.substring(0, 2));
                const month = parseInt(expiryStr.substring(2, 4));
                const day = parseInt(expiryStr.substring(4, 6));
                
                // Convert 2-digit year to 4-digit (assume 20xx for years 00-30, 19xx for 31-99)
                const fullYear = year <= 30 ? 2000 + year : 1900 + year;
                
                // Validate date components
                if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                  // Format as YYYY-MM-DD
                  expiryDate = `${fullYear}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
                }
              }
            }
          }
        }
        
        return {
          valid: true,
          format,
          issuingCountry: issuingCountry || null,
          extractedName: nameSection || null,
          nameParts: nameParts,
          lastName: lastName,
          firstName: firstName,
          passportNumber: passportNumber,
          gender: gender,
          birthdate: birthdate,
          expiryDate: expiryDate,
          raw: mrz
        };
      }
    } catch (error) {
      return {
        valid: false,
        error: `MRZ parsing failed: ${error.message}`,
        raw: mrz
      };
    }
  }
  
  return {
    valid: format !== 'unknown',
    format,
    raw: mrz,
    error: format === 'unknown' ? 'Unrecognized MRZ format' : null
  };
}

/**
 * Generates a hash for MRZ string for duplicate detection
 * @param {string} mrzString - The MRZ string to hash
 * @returns {string|null} SHA-256 hash of normalized MRZ or null if invalid
 */
function generateMRZHash(mrzString) {
  if (!mrzString || typeof mrzString !== 'string') {
    return null;
  }
  
  // Normalize MRZ by removing whitespace and converting to uppercase
  const normalized = mrzString.trim().replace(/\s+/g, '').toUpperCase();
  
  try {
    return crypto.createHash('sha256').update(normalized).digest('hex');
  } catch (error) {
    console.error('MRZ hash generation failed:', error);
    return null;
  }
}

/**
 * Validates OCR confidence score and provides quality assessment
 * @param {number} confidence - OCR confidence score (0-1 or 0-100)
 * @returns {Object} Validation results and quality assessment
 */
function validateOCRConfidence(confidence) {
  if (confidence === null || confidence === undefined) {
    return { valid: false, quality: 'unknown', normalized: null };
  }
  
  const num = parseFloat(confidence);
  if (isNaN(num)) {
    return { valid: false, quality: 'invalid', normalized: null };
  }
  
  // Normalize to 0-1 scale if it appears to be 0-100
  const normalized = num > 1 ? num / 100 : num;
  
  if (normalized < 0 || normalized > 1) {
    return { valid: false, quality: 'out_of_range', normalized: null };
  }
  
  let quality = 'poor';
  if (normalized >= 0.95) quality = 'excellent';
  else if (normalized >= 0.85) quality = 'good';
  else if (normalized >= 0.70) quality = 'fair';
  
  return {
    valid: true,
    quality,
    normalized,
    shouldReview: normalized < 0.85,
    recommendation: normalized < 0.70 ? 'manual_review_required' : 'acceptable'
  };
}

/**
 * Checks for potential duplicate passports based on multiple criteria
 * @param {Object} newPassport - The new passport data to check
 * @param {Array} existingPassports - Array of existing passport records
 * @returns {Object} Duplicate detection results
 */
function detectPassportDuplicates(newPassport, existingPassports = []) {
  const duplicates = {
    exact: [],
    similar: [],
    potential: []
  };
  
  if (!Array.isArray(existingPassports) || !newPassport) {
    return duplicates;
  }
  
  for (const existing of existingPassports) {
    const checks = {
      samePassportNumber: newPassport.passport_number && existing.passport_number && 
                         newPassport.passport_number === existing.passport_number,
      sameMRZHash: newPassport.mrz_hash && existing.mrz_hash && 
                  newPassport.mrz_hash === existing.mrz_hash,
      sameName: newPassport.first_name && existing.first_name &&
               newPassport.first_name.toLowerCase() === existing.first_name.toLowerCase() &&
               newPassport.last_name && existing.last_name &&
               newPassport.last_name.toLowerCase() === existing.last_name.toLowerCase(),
      sameStayAndName: newPassport.stay_id === existing.stay_id && checks.sameName
    };
    
    if (checks.samePassportNumber || checks.sameMRZHash) {
      duplicates.exact.push({ record: existing, reason: 'passport_number_or_mrz_match' });
    } else if (checks.sameStayAndName) {
      duplicates.similar.push({ record: existing, reason: 'same_guest_same_stay' });
    } else if (checks.sameName) {
      duplicates.potential.push({ record: existing, reason: 'name_match_different_stay' });
    }
  }
  
  return duplicates;
}

/**
 * Direct merge-passport logic without HTTP request (for serverless batch processing)
 * @param {Object} passportData - Passport data to merge or insert
 * @returns {Promise<Object>} Result with action: 'merged' or 'inserted'
 */
async function mergePassportDirect(passportData) {
  const { Pool } = require('pg');
  
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  const {
    stay_id,
    first_name,
    middle_name,
    last_name,
    gender,
    birthday,
    passport_number,
    nationality_alpha3,
    issuing_country_alpha3,
    passport_issue_date,
    passport_expiry_date,
    mrz_full,
    mrz_hash,
    ocr_confidence,
    photo_urls,
    source
  } = passportData;

  if (!stay_id || !first_name) {
    throw new Error("stay_id and first_name are required");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Try merge update first
    const updateQuery = `
      UPDATE incoming_guests
      SET
        last_name = COALESCE(NULLIF($1, ''), last_name),
        middle_name = COALESCE(NULLIF($2, ''), middle_name),
        gender = COALESCE(NULLIF($3, ''), gender),
        birthday = COALESCE(NULLIF(NULLIF($4, '')::date, NULL), birthday),
        passport_number = COALESCE(NULLIF($5, ''), passport_number),
        nationality_alpha3 = COALESCE(NULLIF($6, ''), nationality_alpha3),
        issuing_country_alpha3 = COALESCE(NULLIF($7, ''), issuing_country_alpha3),
        passport_issue_date = COALESCE(NULLIF(NULLIF($8, '')::date, NULL), passport_issue_date),
        passport_expiry_date = COALESCE(NULLIF(NULLIF($9, '')::date, NULL), passport_expiry_date),
        mrz_full = COALESCE(NULLIF($10, ''), mrz_full),
        mrz_hash = COALESCE(NULLIF($11, ''), mrz_hash),
        ocr_confidence = COALESCE(NULLIF($12, '')::numeric, ocr_confidence),
        photo_urls = CASE
          WHEN $13::text[] IS NOT NULL AND array_length($13::text[], 1) > 0
          THEN $13::text[]
          ELSE photo_urls
        END,
        source = COALESCE(NULLIF($14, ''), source)
      WHERE stay_id = $15
        AND lower(first_name) = lower($16)
    `;
    const updateValues = [
      last_name || "",
      middle_name || "",
      gender || "",
      birthday || "",
      passport_number || "",
      nationality_alpha3 || "",
      issuing_country_alpha3 || "",
      passport_issue_date || "",
      passport_expiry_date || "",
      mrz_full || "",
      mrz_hash || "",
      ocr_confidence || "",
      photo_urls && photo_urls.length > 0 ? photo_urls : null,
      source || "coco_gpt_merge",
      stay_id,
      first_name
    ];
    const updateResult = await client.query(updateQuery, updateValues);

    // If no update happened, insert new row
    if (updateResult.rowCount === 0) {
      const insertQuery = `
        INSERT INTO incoming_guests (
          stay_id, first_name, middle_name, last_name, gender,
          birthday, passport_number, nationality_alpha3, issuing_country_alpha3,
          passport_issue_date, passport_expiry_date, mrz_full, mrz_hash,
          ocr_confidence, photo_urls, source
        )
        VALUES ($1, $2, $3, $4, $5, NULLIF($6, '')::date, $7, $8, $9, 
                NULLIF($10, '')::date, NULLIF($11, '')::date, $12, $13,
                NULLIF($14, '')::numeric, $15, $16)
      `;
      await client.query(insertQuery, [
        stay_id,
        first_name,
        middle_name || "",
        last_name || "",
        gender || "",
        birthday || "",
        passport_number || "",
        nationality_alpha3 || "",
        issuing_country_alpha3 || "",
        passport_issue_date || "",
        passport_expiry_date || "",
        mrz_full || "",
        mrz_hash || "",
        ocr_confidence || "",
        photo_urls && photo_urls.length > 0 ? photo_urls : null,
        source || "coco_gpt_insert"
      ]);
    }

    await client.query("COMMIT");
    
    return {
      success: true,
      action: updateResult.rowCount > 0 ? "merged" : "inserted"
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Normalizes freeform text into structured stay ID components
 * Extracts room codes and guest names from natural language input
 * @param {string} raw - Raw input string containing room and guest information
 * @returns {Object} Object with parsed components and generated stay_id
 */
function normalizeStayIdFreeform(raw){
  if (!raw) return { input:'', rooms_in:'', last_in:'', rooms:[], last_name_canonical:'', stay_id:'' };
  const cleaned = String(raw).trim().replace(/[,\.;:]+/g,' ');
  const parts = cleaned.split(/[\s_]+/).filter(Boolean);
  const used = new Array(parts.length).fill(false);
  let rooms = [];

  // two-word rooms
  for (let i=0;i<parts.length-1;i++){
    if (used[i]||used[i+1]) continue;
    const two = (parts[i]+' '+parts[i+1]).toLowerCase();
    const match = TWO_WORD_ROOMS.find(r=>r.toLowerCase()===two);
    if (match){ rooms.push(match); used[i]=used[i+1]=true; }
  }
  // one-word rooms and A/B numbers
  for (let i=0;i<parts.length;i++){
    if (used[i]) continue;
    const t = parts[i].toLowerCase();
    const one = ONE_WORD_ROOMS.find(r=>r.toLowerCase()===t);
    if (one){ rooms.push(one); used[i]=true; continue; }
    if (/^[ab][0-9]+$/.test(t)){
      const canon=t.toUpperCase();
      if (ROOM_ORDER.includes(canon)){ rooms.push(canon); used[i]=true; }
    }
  }
  const lastParts = parts.filter((_,i)=>!used[i]);
  // Common lastname connectors that should remain lowercase
  const connectors = ['von', 'van', 'de', 'der', 'den', 'del', 'della', 'di', 'da', 'la', 'le'];
  let lastNameCanonical = lastParts.map((part, idx) => {
    const lower = part.toLowerCase();
    // Keep connectors lowercase, capitalize other parts
    return connectors.includes(lower) ? lower : cap1(part);
  }).join('').replace(/[\s-]+/g,'');
  rooms = Array.from(new Set(rooms));
  rooms.sort((a,b)=>ROOM_ORDER.indexOf(a)-ROOM_ORDER.indexOf(b));
  // Ensure stay_id always uses underscores: replace all whitespace with _, collapse multiple _, trim
  const stay_id = [...rooms, lastNameCanonical].filter(Boolean).join('_').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return {
    input:String(raw),
    rooms_in: rooms.join(', '),
    last_in: lastParts.join(' '),
    rooms,
    last_name_canonical: lastNameCanonical,
    stay_id
  };
}

const http = require('http');
const { handleMotherBrainGuestIntake } = require('./motherbrain-ocr');

const handler = async (req, res) => {
  // ---------- HOTFIX: force-table route ----------
  try {
    const urlObj = new URL(req.url, 'https://x.local');
    if (req.method === 'POST' && urlObj.pathname === '/insert-table') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      // read body (no for-await)
      const raw = await new Promise((resolve,reject)=>{
        try{
          const chunks=[]; req.on('data',c=>chunks.push(Buffer.isBuffer(c)?c:Buffer.from(c)));
          req.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
          req.on('error',reject);
        }catch(e){ resolve(''); }
      });
      let body={}; try{ body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
      const rows = Array.isArray(body.rows) ? body.rows : null;
      if (!rows) { res.statusCode=400; return res.end(JSON.stringify({ ok:false, error:'rows (array) required' })); }

      // normalize photo_urls -> []
      const payload = rows.map(r => ({ ...r, photo_urls: Array.isArray(r.photo_urls) ? r.photo_urls.filter(Boolean) : [] }));

      const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env || {};
      if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
        res.statusCode=500; return res.end(JSON.stringify({ ok:false, error:'missing SUPABASE envs' }));
      }

      const r = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          'Accept-Profile': 'public',
          'Content-Profile': 'public',
          Prefer: 'return=representation,resolution=merge-duplicates'
        },
        body: JSON.stringify(payload)
      });
      const txt = await r.text();
      let data; try { data = JSON.parse(txt); } catch { data = []; }
      if (!r.ok) {
        res.statusCode=r.status;
        return res.end(JSON.stringify({ ok:false, error:'supabase insert failed', status:r.status, body: txt.slice(0,400) }));
      }
      const inserted = Array.isArray(data) ? data.length : (Array.isArray(data.rows)?data.rows.length:payload.length);
      return res.end(JSON.stringify({ ok:true, via:'table', inserted, rows:data }));
    }
  } catch(_) {}
  // ---------- END HOTFIX ----------
  // ---- (removed duplicate /insert hotfix route) ----
  // CORS
  if (sendCORS(req,res)) return;

  // URL + path normalize
  let url;
  try { url = new URL(req.url, 'http://local'); } catch { res.statusCode=400; res.end('Bad URL'); return; }
  url.pathname = (url.pathname.replace(/\/+$/,'') || '/');

  // Health
  if (req.method==='GET' && url.pathname==='/') { res.setHeader('Content-Type','text/plain'); res.end('OK: coco-passport-proxy'); return; }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TOKEET_FEED_URL } = process.env || {};
  const baseHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    'Accept-Profile': 'public',
    'Content-Profile': 'public'
  };

  // --- /resolve ----------------------------------------------------------------
  if (req.method==='GET' && url.pathname==='/resolve'){
    const q = url.searchParams.get('stay_id') || '';
    const out = normalizeStayIdFreeform(q);
    res.setHeader('Content-Type','application/json'); 
    res.end(JSON.stringify(out)); 
    return;
  }

  // --- /upload (binary) --------------------------------------------------------
  if (req.method==='POST' && url.pathname==='/upload'){
    try{
      const stay_id = url.searchParams.get('stay_id'); const filename = (url.searchParams.get('filename')||`${crypto.randomUUID()}.jpg`).replace(/[^A-Za-z0-9._-]/g,'_');
      if (!stay_id){ res.statusCode=400; res.end(JSON.stringify({ok:false,error:'stay_id required'})); return; }
      const objectPath = `passports/${stay_id}/${filename}`;
      const chunks=[]; for await (const c of req) chunks.push(c); const buf = Buffer.concat(chunks);
      const put = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(objectPath)}`, {
        method:'POST',
        headers:{ apikey:SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type':'application/octet-stream', 'x-upsert':'true' },
        body: buf
      });
      const t = await put.text();
      if (!put.ok){ res.statusCode=put.status; res.end(JSON.stringify({ok:false,error:'storage upload failed', body:t})); return; }
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ok:true, object_path:objectPath})); return;
    }catch(e){ res.statusCode=500; res.end(JSON.stringify({ok:false,error:e.message||'upload error'})); return; }
  }

  // --- /upload-url (server fetches from URL) -----------------------------------
  if (req.method==='POST' && url.pathname==='/upload-url'){
    try{
      const { stay_id, url:imgUrl, filename } = await parseBody(req);
      if (!stay_id || !imgUrl){ res.statusCode=400; res.end(JSON.stringify({ok:false,error:'stay_id and url required'})); return; }
      const safeName=(filename||`${crypto.randomUUID()}.jpg`).replace(/[^A-Za-z0-9._-]/g,'_');
      const objectPath = `passports/${stay_id}/${safeName}`;
      
      // Honor SKIP_UPLOADS=1 for CI/testing - bypass Supabase storage
      if (process.env.SKIP_UPLOADS === '1'){ res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ok:true, object_path:objectPath, skipped:true})); return; }
      
      const fr = await fetch(imgUrl); if (!fr.ok){ const tt = await fr.text(); res.statusCode=400; res.end(JSON.stringify({ok:false,error:`fetch image failed: ${fr.status}`, body:tt})); return; }
      const buf = Buffer.from(await fr.arrayBuffer());
      const put = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(objectPath)}`, {
        method:'POST', headers:{ apikey:SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type':'application/octet-stream', 'x-upsert':'true' }, body:buf
      });
      const t = await put.text();
      if (!put.ok){ res.statusCode=put.status; res.end(JSON.stringify({ok:false,error:'storage upload failed', body:t})); return; }
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ok:true, object_path:objectPath})); return;
    }catch(e){ res.statusCode=500; res.end(JSON.stringify({ok:false,error:e.message||'upload-url error'})); return; }
  }

  // --- /insert (RPC first, fallback table with upsert) ------------------------------------
  if (req.method==='POST' && url.pathname==='/insert'){
    const body = await parseBody(req).catch(()=>({}));
    const rows = Array.isArray(body.rows)? body.rows : [];
    if (!rows.length){ res.setHeader('Content-Type','application/json'); res.statusCode=400; res.end(JSON.stringify({ok:false,error:'rows (array) required'})); return; }

    // RPC try first
    const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/insert_incoming_guests`, { method:'POST', headers: baseHeaders, body: JSON.stringify(body) });
    if (rpc.ok){ 
      const text = await rpc.text(); 
      // Wrap RPC response in iOS-expected envelope format
      let rpcData;
      try { rpcData = JSON.parse(text || '[]'); } catch { rpcData = []; }
      const inserted = Array.isArray(rpcData) ? rpcData.length : 0;
      res.setHeader('Content-Type','application/json'); 
      res.statusCode=200; 
      res.end(JSON.stringify({ ok:true, via:'rpc', inserted, rows: rpcData })); 
      return; 
    }

    // Manual upsert logic: check for existing records, update if found, insert if not
    let inserted = 0, updated = 0, skipped = 0;
    const results = [];
    
    for (const row of rows) {
      if (!row.stay_id || !row.first_name) {
        skipped++;
        continue;
      }
      
      // Check if record exists
      const checkUrl = `${SUPABASE_URL}/rest/v1/incoming_guests?stay_id=eq.${encodeURIComponent(row.stay_id)}&first_name=ilike.${encodeURIComponent(row.first_name)}&limit=1`;
      const check = await fetch(checkUrl, { headers: baseHeaders });
      
      if (!check.ok) {
        skipped++;
        continue;
      }
      
      const existing = await check.json();
      
      if (existing && existing.length > 0) {
        // Record exists - update it
        const existingId = existing[0].id;
        const updateUrl = `${SUPABASE_URL}/rest/v1/incoming_guests?id=eq.${existingId}`;
        const updateData = { ...row };
        delete updateData.stay_id; // Don't update the key fields
        delete updateData.first_name;
        
        // Ensure new passport document fields are included in updates
        if (row.issuing_country_alpha3 !== undefined) updateData.issuing_country_alpha3 = row.issuing_country_alpha3;
        if (row.passport_issue_date !== undefined) updateData.passport_issue_date = row.passport_issue_date;
        if (row.passport_expiry_date !== undefined) updateData.passport_expiry_date = row.passport_expiry_date;
        if (row.mrz_full !== undefined) updateData.mrz_full = row.mrz_full;
        if (row.mrz_hash !== undefined) updateData.mrz_hash = row.mrz_hash;
        if (row.ocr_confidence !== undefined) updateData.ocr_confidence = row.ocr_confidence;
        
        const updateResp = await fetch(updateUrl, {
          method: 'PATCH',
          headers: { ...baseHeaders, Prefer: 'return=representation' },
          body: JSON.stringify(updateData)
        });
        
        if (updateResp.ok) {
          const updatedRecord = await updateResp.json();
          results.push(...(Array.isArray(updatedRecord) ? updatedRecord : [updatedRecord]));
          updated++;
        } else {
          skipped++;
        }
      } else {
        // Record doesn't exist - insert it
        const insertResp = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests`, {
          method: 'POST',
          headers: { ...baseHeaders, Prefer: 'return=representation' },
          body: JSON.stringify([row])
        });
        
        if (insertResp.ok) {
          const insertedRecord = await insertResp.json();
          results.push(...(Array.isArray(insertedRecord) ? insertedRecord : [insertedRecord]));
          inserted++;
        } else {
          skipped++;
        }
      }
    }
    
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({ 
      ok: true, 
      via: 'table-manual-upsert', 
      inserted, 
      updated, 
      skipped, 
      rows: results 
    }));
    return;
  }

  // --- /passport (direct PostgreSQL merge-or-insert) --------------------------
  if (req.method === 'POST' && url.pathname === '/passport') {
    const { Pool } = require('pg');
    
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });

    try {
      const body = await parseBody(req).catch(() => ({}));
      const {
        stay_id,
        first_name,
        middle_name,
        last_name,
        gender,
        birthday,
        passport_number,
        nationality_alpha3,
        photo_urls,
        source
      } = body;

      if (!stay_id || !first_name) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: "stay_id and first_name are required" }));
        return;
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // 1️⃣ Try merge update first
        const updateQuery = `
          UPDATE incoming_guests
          SET
            last_name = COALESCE(NULLIF($1, ''), last_name),
            middle_name = COALESCE(NULLIF($2, ''), middle_name),
            gender = COALESCE(NULLIF($3, ''), gender),
            birthday = COALESCE(NULLIF($4::date, NULL), birthday),
            passport_number = COALESCE(NULLIF($5, ''), passport_number),
            nationality_alpha3 = COALESCE(NULLIF($6, ''), nationality_alpha3),
            photo_urls = CASE
              WHEN $7::text[] IS NOT NULL AND array_length($7::text[], 1) > 0
              THEN $7::text[]
              ELSE photo_urls
            END,
            source = COALESCE(NULLIF($8, ''), source)
          WHERE stay_id = $9
            AND lower(first_name) = lower($10)
        `;
        const updateValues = [
          last_name || "",
          middle_name || "",
          gender || "",
          birthday || null,
          passport_number || "",
          nationality_alpha3 || "",
          photo_urls && photo_urls.length > 0 ? photo_urls : null,
          source || "api_merge",
          stay_id,
          first_name
        ];
        const updateResult = await client.query(updateQuery, updateValues);

        // 2️⃣ If no update happened, insert new row
        if (updateResult.rowCount === 0) {
          const insertQuery = `
            INSERT INTO incoming_guests (
              stay_id, first_name, middle_name, last_name, gender,
              birthday, passport_number, nationality_alpha3, photo_urls, source
            ) VALUES ($1, $2, $3, $4, $5, $6::date, $7, $8, $9, $10)
          `;
          await client.query(insertQuery, [
            stay_id,
            first_name,
            middle_name || "",
            last_name || "",
            gender || "",
            birthday || null,
            passport_number || "",
            nationality_alpha3 || "",
            photo_urls && photo_urls.length > 0 ? photo_urls : null,
            source || "api_insert"
          ]);
        }

        await client.query("COMMIT");
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ 
          success: true, 
          action: updateResult.rowCount > 0 ? "merged" : "inserted" 
        }));
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(err);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: err.message }));
      } finally {
        client.release();
      }
    } catch (err) {
      console.error(err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // --- /coco-gpt-batch-passport (CocoGPT batch processing) --------------------
  if (req.method === 'POST' && url.pathname === '/coco-gpt-batch-passport') {
    try {
      const body = await parseBody(req).catch(() => ({}));
      const { stay_id, passports, mrz_list } = body;
      
      // Handle mrz_list format from CocoGPT YAML (array of MRZ line pairs)
      let passportsToProcess = passports;
      if (mrz_list && Array.isArray(mrz_list) && mrz_list.length > 0) {
        // Convert mrz_list format to passports format
        passportsToProcess = mrz_list.map(mrzLines => {
          if (Array.isArray(mrzLines) && mrzLines.length === 2) {
            // Join the two MRZ lines with a newline
            const mrzFull = mrzLines.join('\n');
            return {
              mrz_full: mrzFull
            };
          }
          return {};
        });
      }
      
      // Be more permissive with stay_id - auto-normalize if provided, allow empty for basic processing
      let normalizedStayId = stay_id;
      if (stay_id && typeof stay_id === 'string') {
        const normalized = normalizeStayIdFreeform(stay_id);
        if (normalized.stay_id) {
          normalizedStayId = normalized.stay_id;
        }
        // If normalization fails, keep original - let the database decide
      }
      
      if ((!Array.isArray(passportsToProcess) || passportsToProcess.length === 0) && !mrz_list) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ 
          error: "passports array or mrz_list is required",
          expected_formats: {
            format1: {
              stay_id: "B7_Kislinger (optional - will be auto-normalized)",
              passports: [
                {
                  first_name: "Stefan (required or extracted from MRZ)",
                  last_name: "Kislinger", 
                  passport_number: "P123456",
                  nationality_alpha3: "DEU",
                  mrz_full: "P<DEUKISLINGER<<STEFAN<<<<<<<<<<<<<<<<<<<<<",
                  ocr_confidence: 0.95
                }
              ]
            },
            format2_from_cocogpt: {
              mrz_list: [
                ["P<DEUKISLINGER<<STEFAN<<<<<<<<<<<<<<<<<<<<<", "1234567890DEU9001014M2301014<<<<<<<<<<<<<<04"]
              ]
            }
          }
        }));
        return;
      }
      
      const results = [];
      let merged = 0, inserted = 0, errors = 0;
      
      // Process each passport in the batch
      for (let i = 0; i < passportsToProcess.length; i++) {
        const passport = passportsToProcess[i];
        
        try {
          // Enhanced validation and processing
          const warnings = [];
          
          // Validate and parse MRZ if provided - do this FIRST to extract names
          let mrzData = null;
          let mrzHash = passport.mrz_hash;
          if (passport.mrz_full) {
            mrzData = parseMRZ(passport.mrz_full);
            if (!mrzData.valid) {
              warnings.push(`Invalid MRZ: ${mrzData.error}`);
            } else {
              // Auto-generate MRZ hash if not provided
              if (!mrzHash) {
                mrzHash = generateMRZHash(passport.mrz_full);
              }
              
              // Cross-validate MRZ data with provided data
              if (mrzData.issuingCountry && passport.issuing_country_alpha3 && 
                  mrzData.issuingCountry !== passport.issuing_country_alpha3) {
                warnings.push(`MRZ country (${mrzData.issuingCountry}) doesn't match issuing_country_alpha3 (${passport.issuing_country_alpha3})`);
              }
            }
          }
          
          // Extract first_name from MRZ if not provided directly
          let firstName = passport.first_name || (mrzData?.valid ? mrzData.firstName : null);
          let middleName = passport.middle_name || '';
          const lastName = passport.last_name || (mrzData?.valid ? mrzData.lastName : null);
          const birthdateFromMRZ = mrzData?.valid ? mrzData.birthdate : null;
          
          // Store original first name for response (before splitting)
          const originalFirstName = firstName;
          
          // Split firstname if it contains spaces (e.g., "Ralph Can" -> "Ralph" + "Can")
          if (firstName && firstName.includes(' ')) {
            const nameParts = firstName.trim().split(/\s+/);
            firstName = nameParts[0]; // First part becomes firstname
            // Remaining parts become middle name (combine with existing middle name if any)
            const extractedMiddle = nameParts.slice(1).join(' ');
            if (extractedMiddle) {
              middleName = middleName ? `${extractedMiddle} ${middleName}` : extractedMiddle;
            }
          }
          
          // Validate that we have at least a first name (from input or MRZ)
          if (!firstName) {
            results.push({
              index: i,
              status: 'error',
              error: 'first_name is required (either directly provided or extractable from MRZ)',
              passport: passport
            });
            errors++;
            continue;
          }
          
          // Validate OCR confidence
          let ocrValidation = null;
          if (passport.ocr_confidence !== null && passport.ocr_confidence !== undefined) {
            ocrValidation = validateOCRConfidence(passport.ocr_confidence);
            if (!ocrValidation.valid) {
              warnings.push(`Invalid OCR confidence: ${ocrValidation.quality}`);
            } else if (ocrValidation.shouldReview) {
              warnings.push(`Low OCR confidence (${ocrValidation.normalized}): ${ocrValidation.recommendation}`);
            }
          }
          
          // Prepare passport data with normalized stay_id and source
          // Photo URLs are no longer processed - CocoGPT only sends MRZ data
          const passportData = {
            stay_id: normalizedStayId || stay_id || `unknown_${Date.now()}`, // Fallback for missing stay_id
            first_name: firstName, // Use extracted name from MRZ if available
            middle_name: middleName, // Use split middle name if extracted from firstname
            last_name: lastName || '', // Use extracted name from MRZ if available
            gender: passport.gender || (mrzData?.valid ? mrzData.gender : '') || '',
            birthday: passport.birthday || birthdateFromMRZ || '',
            passport_number: passport.passport_number || (mrzData?.valid ? mrzData.passportNumber : '') || '',
            nationality_alpha3: passport.nationality_alpha3 || (mrzData?.valid ? mrzData.issuingCountry : '') || '',
            issuing_country_alpha3: passport.issuing_country_alpha3 || (mrzData?.issuingCountry) || '',
            passport_issue_date: passport.passport_issue_date || '',
            passport_expiry_date: passport.passport_expiry_date || (mrzData?.valid ? mrzData.expiryDate : '') || '',
            mrz_full: passport.mrz_full || '',
            mrz_hash: mrzHash || '',
            ocr_confidence: ocrValidation?.normalized || passport.ocr_confidence || null,
            photo_urls: [], // Always empty - photos no longer needed from CocoGPT
            source: 'coco_gpt_batch'
          };
          
          // In test environment, use HTTP calls to mock endpoints, in production use direct DB
          try {
            let mergeResult;
            if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID) {
              // Use HTTP call for test environment (to enable mocking)
              const response = await fetch(`${req.headers.origin || 'http://localhost:3000'}/merge-passport`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(passportData)
              });
              
              if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${await response.text()}`);
              }
              
              mergeResult = await response.json();
            } else {
              // Use direct database call for production (avoid serverless HTTP issues)
              mergeResult = await mergePassportDirect(passportData);
            }
            
            results.push({
              index: i,
              status: 'success',
              action: mergeResult.action,
              first_name: originalFirstName, // Return original name for CocoGPT compatibility
              passport_number: passport.passport_number
            });
            
            if (mergeResult.action === 'merged') {
              merged++;
            } else {
              inserted++;
            }
          } catch (mergeError) {
            results.push({
              index: i,
              status: 'error',
              error: `Merge failed: ${mergeError.message}`,
              passport: passport
            });
            errors++;
          }
        } catch (err) {
          results.push({
            index: i,
            status: 'error',
            error: err.message,
            passport: passport
          });
          errors++;
        }
      }
      
      // Google Sheets output removed - data now exported directly from Supabase via daily TM30 export
      
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        success: true,
        stay_id: normalizedStayId,
        summary: {
          total: passportsToProcess.length,
          merged,
          inserted,
          errors
        },
        results
        // sheets_format removed - use Supabase daily TM30 export instead
      }));
      
    } catch (err) {
      console.error('CocoGPT batch processing error:', err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // --- /merge-passport (direct PostgreSQL merge-or-insert) --------------------
  if (req.method === 'POST' && url.pathname === '/merge-passport') {
    const { Pool } = require('pg');
    
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });

    try {
      const body = await parseBody(req).catch(() => ({}));
      const {
        stay_id,
        first_name,
        middle_name,
        last_name,
        gender,
        birthday,
        passport_number,
        nationality_alpha3,
        issuing_country_alpha3,
        passport_issue_date,
        passport_expiry_date,
        mrz_full,
        mrz_hash,
        ocr_confidence,
        photo_urls,
        source
      } = body;

      if (!stay_id || !first_name) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: "stay_id and first_name are required" }));
        return;
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Try merge update first
        const updateQuery = `
          UPDATE incoming_guests
          SET
            last_name = COALESCE(NULLIF($1, ''), last_name),
            middle_name = COALESCE(NULLIF($2, ''), middle_name),
            gender = COALESCE(NULLIF($3, ''), gender),
            birthday = COALESCE(NULLIF(NULLIF($4, '')::date, NULL), birthday),
            passport_number = COALESCE(NULLIF($5, ''), passport_number),
            nationality_alpha3 = COALESCE(NULLIF($6, ''), nationality_alpha3),
            issuing_country_alpha3 = COALESCE(NULLIF($7, ''), issuing_country_alpha3),
            passport_issue_date = COALESCE(NULLIF(NULLIF($8, '')::date, NULL), passport_issue_date),
            passport_expiry_date = COALESCE(NULLIF(NULLIF($9, '')::date, NULL), passport_expiry_date),
            mrz_full = COALESCE(NULLIF($10, ''), mrz_full),
            mrz_hash = COALESCE(NULLIF($11, ''), mrz_hash),
            ocr_confidence = COALESCE(NULLIF($12, '')::numeric, ocr_confidence),
            photo_urls = CASE
              WHEN $13::text[] IS NOT NULL AND array_length($13::text[], 1) > 0
              THEN $13::text[]
              ELSE photo_urls
            END,
            source = COALESCE(NULLIF($14, ''), source)
          WHERE stay_id = $15
            AND lower(first_name) = lower($16)
        `;
        const updateValues = [
          last_name || "",
          middle_name || "",
          gender || "",
          birthday || "",
          passport_number || "",
          nationality_alpha3 || "",
          issuing_country_alpha3 || "",
          passport_issue_date || "",
          passport_expiry_date || "",
          mrz_full || "",
          mrz_hash || "",
          ocr_confidence || "",
          photo_urls && photo_urls.length > 0 ? photo_urls : null,
          source || "coco_gpt_merge",
          stay_id,
          first_name
        ];
        const updateResult = await client.query(updateQuery, updateValues);

        // If no update happened, insert new row
        if (updateResult.rowCount === 0) {
          const insertQuery = `
            INSERT INTO incoming_guests (
              stay_id, first_name, middle_name, last_name, gender,
              birthday, passport_number, nationality_alpha3, issuing_country_alpha3,
              passport_issue_date, passport_expiry_date, mrz_full, mrz_hash,
              ocr_confidence, photo_urls, source
            )
            VALUES ($1, $2, $3, $4, $5, NULLIF($6, '')::date, $7, $8, $9, 
                    NULLIF($10, '')::date, NULLIF($11, '')::date, $12, $13,
                    NULLIF($14, '')::numeric, $15, $16)
          `;
          await client.query(insertQuery, [
            stay_id,
            first_name,
            middle_name || "",
            last_name || "",
            gender || "",
            birthday || "",
            passport_number || "",
            nationality_alpha3 || "",
            issuing_country_alpha3 || "",
            passport_issue_date || "",
            passport_expiry_date || "",
            mrz_full || "",
            mrz_hash || "",
            ocr_confidence || "",
            photo_urls && photo_urls.length > 0 ? photo_urls : null,
            source || "coco_gpt_insert"
          ]);
        }

        await client.query("COMMIT");

        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          success: true,
          action: updateResult.rowCount > 0 ? "merged" : "inserted"
        }));
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(err);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: err.message }));
      } finally {
        client.release();
      }
    } catch (err) {
      console.error(err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // --- /export (tab-delimited 7 cols, header) ---------------------------------
  if (req.method==='GET' && url.pathname==='/export'){
    const stay_id = url.searchParams.get('stay_id');
    const rooms = url.searchParams.get('rooms');
    const last = url.searchParams.get('last');
    let effectiveStay = stay_id;
    if (!effectiveStay && (rooms || last)){
      const label = [rooms||'', last||''].join(' ').trim();
      const r = normalizeStayIdFreeform(label);
      effectiveStay = r.stay_id;
    }
    res.setHeader('Content-Type','text/plain; charset=utf-8');
    if (!effectiveStay){ res.end('First Name\tMiddle Name\tLast Name\tGender\tPassport Number\tNationality\tBirthday'); return; }

    const qs = new URLSearchParams({
      'stay_id': `eq.${effectiveStay}`,
      'order': 'created_at.asc',
      'select': '"First Name","Middle Name","Last Name","Gender","Passport Number","Nationality","Birthday"'
    }).toString();

    const r = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests_export_view?${qs}`, { headers: baseHeaders });
    const txt = await r.text();
    if (!r.ok){ res.statusCode=r.status; res.end('First Name\tMiddle Name\tLast Name\tGender\tPassport Number\tNationality\tBirthday'); return; }

    let out = 'First Name\tMiddle Name\tLast Name\tGender\tPassport Number\tNationality\tBirthday';
    try{
      const arr = JSON.parse(txt);
      for (const row of arr){
        out += `\n${row["First Name"]||''}\t${row["Middle Name"]||''}\t${row["Last Name"]||''}\t${row["Gender"]||''}\t${row["Passport Number"]||''}\t${row["Nationality"]||''}\t${row["Birthday"]||''}`;
      }
    }catch{}
    res.end(out); return;
  }

  // --- /status (one-line) -----------------------------------------------------
  if (req.method==='GET' && url.pathname==='/status'){
    const stay_id = url.searchParams.get('stay_id');
    res.setHeader('Content-Type','text/plain; charset=utf-8');
    if (!stay_id){ res.end('0 of ? passports received 📸'); return; }
    const qs = new URLSearchParams({ 'stay_id': `eq.${stay_id}` }).toString();
    const r = await fetch(`${SUPABASE_URL}/rest/v1/v_passport_status_by_stay?${qs}`, { headers: baseHeaders });
    const txt = await r.text();
    if (!r.ok){ res.statusCode=r.status; res.end('0 of ? passports received 📸'); return; }
    try{ const arr = JSON.parse(txt); res.end(arr[0]?.status || '0 of ? passports received 📸'); }
    catch{ res.end('0 of ? passports received 📸'); }
    return;
  }

  // --- /tokeet-upsert (pull feed URL, preseed) --------------------------------
  if (url.pathname==='/tokeet-upsert'){
    if (req.method!=='POST'){ res.statusCode=405; res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ok:false,error:'Method Not Allowed. Use POST.'})); return; }
    try{
      const body = await parseBody(req).catch(()=>({}));
      const feedUrlRaw = body.feed_url || TOKEET_FEED_URL;
      if (!feedUrlRaw){ res.statusCode=400; res.end(JSON.stringify({ ok:false, error:'missing feed_url (body) or TOKEET_FEED_URL env' })); return; }
      const feedUrl = resolveTemplateDates(feedUrlRaw);
      const feed = await fetchJson(feedUrl);
      if (!feed.ok){ res.statusCode=feed.status||500; res.end(JSON.stringify({ ok:false, error:'fetch feed failed', body: feed.text })); return; }

      let dbRows = [];
      
      // Check if response is JSON or CSV
      if (feed.json && Array.isArray(feed.json)) {
        // JSON format (original logic) - convert to DB objects
        for (const jsonItem of feed.json) {
          // Create a pseudo-CSV row for compatibility with parseCSVRowToDBObject
          const pseudoCSVRow = [
            jsonItem.Name || jsonItem.full_name || '',
            jsonItem.Email || jsonItem.email || '',
            '', // Guest Secondary Emails
            jsonItem.Telephone || jsonItem.phone || '',
            '', // Guest Secondary Phones
            jsonItem.Address || jsonItem.guest_address || '',
            jsonItem.Status || jsonItem.booking_status || '',
            jsonItem.Rental || jsonItem.rental || '',
            jsonItem.Arrive || jsonItem.check_in || '',
            jsonItem.Depart || jsonItem.check_out || '',
            jsonItem.Nights || jsonItem.nights || '',
            jsonItem.Received || '',
            jsonItem.Checkin || jsonItem.checkin_time || '',
            jsonItem.Checkout || jsonItem.checkout_time || '',
            jsonItem.BookingID || jsonItem.booking_id || '',
            jsonItem.InquiryID || jsonItem.inquiry_id || '',
            jsonItem.Source || jsonItem.source || '',
            jsonItem.Booked || '',
            jsonItem.Adults || jsonItem.adults || '',
            jsonItem.Children || jsonItem.children || '',
            jsonItem.Currency || jsonItem.currency || '',
            jsonItem.TotalCost || jsonItem.total_cost || '',
            jsonItem.BaseRate || jsonItem.base_rate || '',
            jsonItem.Tax || jsonItem.tax || '',
            jsonItem.BookingFormula || jsonItem.booking_formula || '',
            jsonItem.GuestID || jsonItem.guest_id || ''
          ];
          
          const headers = Object.keys(CSV_TO_DB_MAPPING);
          const dbObject = parseCSVRowToDBObject(pseudoCSVRow, headers);
          if (dbObject.stay_id) {
            dbRows.push(dbObject);
          }
        }
      } else if (feed.text && (feed.text.includes('"Name"') || feed.text.includes('Name,'))) {
        // CSV format - use proper csv-parse
        try {
          const records = parse(feed.text, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
            quote: '"',
            delimiter: ','
          });
          
          // Convert each CSV record to DB object with type coercion
          for (const record of records) {
            // Extract headers and values in the same order as CSV_TO_DB_MAPPING
            const headers = Object.keys(record);
            const values = headers.map(header => record[header] || '');
            
            const dbObject = parseCSVRowToDBObject(values, headers);
            if (dbObject.stay_id) {
              dbRows.push(dbObject);
            }
          }
        } catch (csvError) {
          console.error('CSV parsing failed:', csvError.message);
          res.statusCode = 400;
          res.end(JSON.stringify({ ok: false, error: 'CSV parsing failed', details: csvError.message }));
          return;
        }
      } else {
        // Fallback - try to use existing JSON structure
        const fallbackItems = feed.json?.items || [];
        for (const item of fallbackItems) {
          const dbObject = {
            stay_id: item.stay_id || null,
            first_name: item.first_name || item.first || null,
            last_name: item.last_name || item.last || item.guest_last || null,
            source: 'tokeet_upsert',
            raw_json: item
          };
          if (dbObject.stay_id) {
            dbRows.push(dbObject);
          }
        }
      }

      if (!dbRows.length){ res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ ok:true, upserted:0 })); return; }

      // Validate and ensure all required fields for insert_incoming_guests RPC are present
      const validatedRows = dbRows.map(row => {
        // Ensure all required fields are present, pass null for optional ones
        const validatedRow = {
          // Core identity fields (required)
          stay_id: row.stay_id || null,
          first_name: row.first_name || null,
          last_name: row.last_name || null,
          
          // Optional identity fields
          middle_name: row.middle_name || null,
          gender: row.gender || null,
          birthday: row.birthday || null,
          passport_number: row.passport_number || null,
          nationality_alpha3: row.nationality_alpha3 || null,
          issuing_country_alpha3: row.issuing_country_alpha3 || null,
          passport_issue_date: row.passport_issue_date || null,
          passport_expiry_date: row.passport_expiry_date || null,
          
          // Contact information
          email: row.email || null,
          secondary_emails: row.secondary_emails || null,
          phone_e164: row.phone_e164 || null,
          secondary_phones: row.secondary_phones || null,
          guest_address: row.guest_address || null,
          
          // Booking information
          booking_status: row.booking_status || null,
          booking_channel: row.booking_channel || null,
          rental_unit: row.rental_unit || null,
          rental_units: row.rental_units || null,
          check_in_date: row.check_in_date || null,
          check_out_date: row.check_out_date || null,
          nights: row.nights || null,
          date_received: row.date_received || null,
          checkin_time: row.checkin_time || null,
          checkout_time: row.checkout_time || null,
          booking_id: row.booking_id || null,
          inquiry_id: row.inquiry_id || null,
          external_reservation_id: row.external_reservation_id || null,
          adults: row.adults || null,
          children: row.children || null,
          currency: row.currency || null,
          total_cost: row.total_cost || null,
          base_rate: row.base_rate || null,
          tax: row.tax || null,
          booking_formula: row.booking_formula || null,
          guest_id: row.guest_id || null,
          
          // Document verification fields
          mrz_full: row.mrz_full || null,
          mrz_hash: row.mrz_hash || null,
          ocr_confidence: row.ocr_confidence || null,
          
          // Communication fields
          whatsapp_chat_id: row.whatsapp_chat_id || null,
          whatsapp_group_id: row.whatsapp_group_id || null,
          
          // Media and system fields
          photo_urls: Array.isArray(row.photo_urls) ? row.photo_urls.filter(Boolean) : [],
          source: row.source || 'tokeet_upsert',
          source_batch_id: row.source_batch_id || null,
          status: row.status || 'pending_review',
          notes: row.notes || null,
          raw_json: row.raw_json || row,
          row_type: row.row_type || 'booking',
          guest_index: row.guest_index || null,
          nickname: row.nickname || null
        };
        return validatedRow;
      });

      // Try RPC first with complete mapped objects
      const rpcPayload = { rows: validatedRows };
      const rpc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/insert_incoming_guests`, {
        method:'POST', headers: baseHeaders, body: JSON.stringify(rpcPayload)
      });
      
      if (rpc.ok){ 
        const text = await rpc.text(); 
        // Wrap RPC response in expected envelope format
        let rpcData;
        try { rpcData = JSON.parse(text || '[]'); } catch { rpcData = []; }
        const inserted = Array.isArray(rpcData) ? rpcData.length : validatedRows.length;
        res.setHeader('Content-Type','application/json'); 
        res.statusCode=200; 
        res.end(JSON.stringify({ ok:true, via:'rpc', inserted, rows: rpcData })); 
        return; 
      }

      // Fallback to direct table insert if RPC fails
      const put = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests`, {
        method:'POST', headers:{ ...baseHeaders, Prefer:'resolution=merge-duplicates' }, body: JSON.stringify(validatedRows)
      });
      const txt = await put.text();
      if (!put.ok){ res.statusCode=put.status; res.end(JSON.stringify({ ok:false, error:'upsert failed via both RPC and table', rpc_status: rpc.status, table_body:txt })); return; }
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ ok:true, via:'table_fallback', upserted: validatedRows.length })); return;
    }catch(e){ res.statusCode=500; res.end(JSON.stringify({ ok:false, error:e.message||'tokeet-upsert error' })); return; }
  }

  // --- /tokeet-upsert-rows (DIRECT preseed) -----------------------------------
  if (req.method==='POST' && url.pathname==='/tokeet-upsert-rows'){
    try{
      const body = await parseBody(req).catch(()=>({}));
      const rows = Array.isArray(body.rows)? body.rows : [];
      if (!rows.length){ res.statusCode=400; res.end(JSON.stringify({ ok:false, error:'rows (array) required' })); return; }
      if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY){ res.statusCode=500; res.end(JSON.stringify({ ok:false, error:'missing SUPABASE envs' })); return; }

      const put = await fetch(`${SUPABASE_URL}/rest/v1/stays_preseed`, {
        method:'POST',
        headers:{ ...baseHeaders, Prefer:'resolution=merge-duplicates' },
        body: JSON.stringify(rows)
      });
      const txt = await put.text();
      if (!put.ok){ res.statusCode=put.status; res.end(JSON.stringify({ ok:false, error:'upsert failed', body:txt })); return; }
      res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ ok:true, upserted: rows.length })); return;
    }catch(e){ res.statusCode=500; res.end(JSON.stringify({ ok:false, error:e.message||'tokeet-upsert-rows error' })); return; }
  }

  // --- /ocr (URL-based Google Vision OCR) -------------------------------------
  if (req.method === 'POST' && url.pathname === '/ocr') {
    try {
      const body = await parseBody(req).catch(() => ({}));
      if (!body || !body.imageUrl) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'imageUrl is required' }));
        return;
      }

      const client = createVisionClient();
      const [result] = await client.textDetection(body.imageUrl);
      const detections = result?.textAnnotations || [];
      const fullText = detections.length > 0 ? detections[0].description : '';

      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, text: fullText, raw: detections }));
    } catch (err) {
      console.error('OCR error:', err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: String(err?.message || err) }));
    }
    return;
  }

  // --- /passport-ocr (multipart images -> TSV via Google Vision) ---------------
  if (req.method === 'POST' && url.pathname === '/passport-ocr') {
    try {
      // Content-Length limits for abuse prevention
      const contentLength = parseInt(req.headers['content-length'] || '0');
      const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10MB limit for images
      
      if (contentLength > MAX_UPLOAD_SIZE) {
        res.statusCode = 413;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'payload_too_large', max_size: MAX_UPLOAD_SIZE }));
        return;
      }
      
      const { files, default_checkout } = await parseMultipart(req);
      if (!files || !files.length) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'no_images' }));
        return;
      }
      
      // Limit number of files
      const MAX_FILES = 10;
      if (files.length > MAX_FILES) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'too_many_files', max_files: MAX_FILES, received: files.length }));
        return;
      }

      const client = createVisionClient(); // uses inline credentials or file path
      const guests = [];
      for (const buf of files) {
        const [result] = await client.documentTextDetection({ image: { content: buf } });
        const text = result?.fullTextAnnotation?.text || (result?.textAnnotations || []).map(a => a.description).join('\n') || '';
        const fields = parseVIZ(text);
        guests.push({ ...fields, checkout: '' });
      }

      // TSV: First | Middle | Last | Gender | Passport | Nationality | Birthday | Checkout
      const guests_tsv = guests.map(g =>
        [g.first_name, g.middle_name, g.last_name, g.gender, g.passport_number, g.nationality_alpha3, g.birthday, ''].join('\t')
      ).join('\n');

      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ guests_tsv, guests, default_checkout: default_checkout || '' }));
    } catch (e) {
      console.error('passport-ocr error:', e);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'ocr_failed', detail: String(e?.message || e) }));
    }
    return;
  }

  // ================== ROUTE (place AFTER /passport-ocr and BEFORE 404) ==================
  // --- /coco-gpt-batch-tsv route starts here ---
  if (req.method === 'POST' && url.pathname === '/coco-gpt-batch-tsv') {
    try {
      // Size limits for abuse prevention
      const contentLength = parseInt(req.headers['content-length'] || '0');
      const MAX_PAYLOAD_SIZE = 1024 * 1024; // 1MB limit
      
      if (contentLength > MAX_PAYLOAD_SIZE) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: `Payload too large. Max ${MAX_PAYLOAD_SIZE} bytes` }));
      }
      
      const body = await parseBody(req);
      const { stay_id, default_checkout, guests_tsv } = body || {};

      if (!stay_id || !guests_tsv) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: 'stay_id and guests_tsv required' }));
      }
      
      // Line count limit
      const lines = String(guests_tsv).split(/\r?\n/).filter(l => l.trim());
      const MAX_LINES = 50;
      
      if (lines.length > MAX_LINES) {
        logTSVOperation('tsv_rejected_too_many_lines', {
          stay_id,
          line_count: lines.length,
          max_allowed: MAX_LINES
        });
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ 
          ok: false, 
          error: `Too many lines in TSV. Max ${MAX_LINES} allowed, got ${lines.length}` 
        }));
      }

      const result = await insertGuestsFromTSV({ stay_id, default_checkout, guests_tsv });
      const { insertedCount, badRows } = result;

      if (insertedCount === 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ 
          ok: false, 
          error: 'no valid TSV rows after parsing',
          bad_rows: badRows
        }));
      }

      const response = { ok: true, inserted: insertedCount };
      if (badRows && badRows.length > 0) {
        response.bad_rows = badRows;
        response.message = `${insertedCount} rows inserted, ${badRows.length} rows rejected`;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(response));
    } catch (err) {
      // Log structured error for monitoring
      logTSVOperation('tsv_error', {
        error_type: err.name || 'UnknownError',
        error_message: err.message.substring(0, 200), // Truncate for logs
        stack_trace: process.env.NODE_ENV === 'development' ? err.stack : undefined
      });
      
      console.error('POST /coco-gpt-batch-tsv error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: false, error: err.message }));
    }
  }
  // ================== /route ==================

  // --- /motherbrain/guest-intake (OCR + MotherBrainGPT integration) -----------
  if (req.method === 'POST' && url.pathname === '/motherbrain/guest-intake') {
    await handleMotherBrainGuestIntake(req, res);
    return;
  }

  // Fallback
  res.statusCode = 404;
  res.setHeader('Content-Type','application/json');
  res.end(JSON.stringify({ ok:false, error:'Not Found' }));
};

if (require.main === module) {
  const server = http.createServer((req, res) => {
    handler(req, res).catch(err => {
      console.error('Unhandled error:', err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Internal server error' }));
    });
  });

  const port = process.env.PORT || 8080;
  server.listen(port, () => {
    console.log(`Server listening on port ${port}`);
  });
} else {
  module.exports = handler;
}


async function mergeOrInsertPassport(db, newGuest) {
  const { stay_id, first_name, last_name, gender, birthday, passport_number, nationality_alpha3, photo_urls, source } = newGuest;

  // Look for an existing row with same stay_id + first_name (case-insensitive)
  const existing = await db.query(
    `SELECT * FROM incoming_guests
     WHERE stay_id = $1 AND lower(first_name) = lower($2)
     LIMIT 1`,
    [stay_id.trim(), first_name.trim()]
  );

  if (existing.rows.length > 0) {
    const ex = existing.rows[0];
    if (!ex.passport_number) {
      // Merge instead of insert
      await db.query(`
        UPDATE incoming_guests t
        SET
          last_name = COALESCE(NULLIF($1, ''), t.last_name),
          middle_name = COALESCE(NULLIF($2, ''), t.middle_name),
          gender = COALESCE(NULLIF($3, ''), t.gender),
          birthday = COALESCE(NULLIF($4, '')::date, t.birthday),
          passport_number = COALESCE(NULLIF($5, ''), t.passport_number),
          nationality_alpha3 = COALESCE(NULLIF($6, ''), t.nationality_alpha3),
          photo_urls = CASE WHEN $7::jsonb IS NOT NULL AND jsonb_array_length($7::jsonb) > 0 THEN $7::jsonb ELSE t.photo_urls END,
          source = COALESCE(NULLIF($8, ''), t.source)
        WHERE t.id = $9
      `, [
        last_name, newGuest.middle_name || '',
        gender, birthday,
        passport_number, nationality_alpha3,
        JSON.stringify(photo_urls || []), source,
        ex.id
      ]);
      console.log(`Merged passport into existing guest: ${first_name} (${stay_id})`);
      return;
    }
  }

  // No match or passport already present — insert new row
  await db.query(`
    INSERT INTO incoming_guests (stay_id, first_name, middle_name, last_name, gender, birthday, passport_number, nationality_alpha3, photo_urls, source)
    VALUES ($1, $2, $3, $4, $5, NULLIF($6, '')::date, $7, $8, $9::jsonb, $10)
  `, [
    stay_id, first_name, newGuest.middle_name || '', last_name,
    gender, birthday, passport_number, nationality_alpha3,
    JSON.stringify(photo_urls || []), source
  ]);
}

// --- Automatic merge_passport fallback --------------------------------------
async function handlePassportUpsertOrMerge(passportData) {
  // Step 1: Try upsert
  const upsertResp = await fetchJson(`${PASSPORT_PROXY_BASE_URL}/upsertPassport`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: [passportData] })
  });

  if (!upsertResp.ok) {
    console.error("Upsert failed", upsertResp.status, upsertResp.text);
    return upsertResp;
  }

  // Step 2: If no insert happened, call merge_passport
  if (upsertResp.json && upsertResp.json.inserted === 0) {
    console.log(`No new row inserted for stay_id=${passportData.stay_id}, first_name=${passportData.first_name}. Merging...`);

    const mergeResp = await fetchJson(`${process.env.SUPABASE_URL}/rest/v1/rpc/merge_passport`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({
        p_stay_id: passportData.stay_id,
        p_first_name: passportData.first_name,
        p_middle_name: passportData.middle_name || '',
        p_last_name: passportData.last_name || '',
        p_gender: passportData.gender || '',
        p_birthday: passportData.birthday || null,
        p_passport_number: passportData.passport_number || '',
        p_nationality_alpha3: passportData.nationality_alpha3 || '',
        p_issuing_country_alpha3: passportData.issuing_country_alpha3 || '',
        p_passport_issue_date: passportData.passport_issue_date || null,
        p_passport_expiry_date: passportData.passport_expiry_date || null,
        p_mrz_full: passportData.mrz_full || '',
        p_mrz_hash: passportData.mrz_hash || '',
        p_ocr_confidence: passportData.ocr_confidence || null,
        p_photo_urls: passportData.photo_urls || [],
        p_source: passportData.source || ''
      })
    });

    if (!mergeResp.ok) {
      console.error("Merge failed", mergeResp.status, mergeResp.text);
    } else {
      console.log(`Merge completed for ${passportData.first_name} (${passportData.stay_id})`);
    }
    return mergeResp;
  }

  return upsertResp;
}
