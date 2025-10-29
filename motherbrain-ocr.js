/**
 * MotherBrain OCR & Guest Intake Integration
 * 
 * This module processes passport photo uploads via Google Vision OCR
 * and sends structured guest data to MotherBrainGPT API.
 * 
 * Endpoint: POST /motherbrain/guest-intake
 * 
 * Accepts:
 * - multipart/form-data with images[] and optional fields:
 *   - _stay_id: Stay identifier (e.g., "A5_Crowley")
 *   - _phone: Phone number
 *   - _nickname: Guest nickname
 *   - _display_name: Display name
 *   - _notes: Additional notes
 * 
 * Returns:
 * - JSON response with OCR results and MotherBrainGPT API status
 */

const { ImageAnnotatorClient } = require('@google-cloud/vision');
const busboy = require('busboy');
// Native fetch (Node.js 18+) - no import needed

// Reuse the same Vision client configuration from index.js
function createVisionClient() {
  const credsEnv = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  
  if (!credsEnv) {
    return new ImageAnnotatorClient();
  }
  
  try {
    const credsObj = JSON.parse(credsEnv);
    return new ImageAnnotatorClient({ credentials: credsObj });
  } catch (e) {
    return new ImageAnnotatorClient();
  }
}

// Parse VIZ data from OCR text (reused from index.js)
function titleCase(s) {
  return s ? s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : s;
}

function formatDDMMYYYY(s) {
  const m = String(s || '').trim().match(/^(\d{2})[\/.\- ](\d{2})[\/.\- ](\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ''; // Return as YYYY-MM-DD
}

function parseVIZ(text) {
  const up = (text || '').toUpperCase();
  const pull = (...rxs) => {
    for (const rx of rxs) {
      const m = up.match(rx);
      if (m) return m[1].trim();
    }
    return null;
  };

  const last = pull(/SURNAME[:\s]*([A-Z \-']+)/, /NAAM[:\s]*([A-Z \-']+)/, /APELLIDOS?[:\s]*([A-Z \-']+)/);
  const given = pull(/GIVEN NAMES?[:\s]*([A-Z \-']+)/, /VOORNAMEN[:\s]*([A-Z \-']+)/, /NOMBRES?[:\s]*([A-Z \-']+)/);
  const number = pull(/(?:DOCUMENT|PASSPORT)\s?NO\.?[:\s]*([A-Z0-9]+)/, /DOCUMENTNR[:\s]*([A-Z0-9]+)/);
  const nat = pull(/NATIONALITY[:\s]*([A-Z \-]+)/, /NATIONALITE[TÉ]?\s*[:\s]*([A-Z \-]+)/, /NATIONALITEIT[:\s]*([A-Z \-]+)/);
  const dob = pull(/DATE OF BIRTH[:\s]*([0-9.\/\- ]+)/, /GEBOORTEDATUM[:\s]*([0-9.\/\- ]+)/, /FECHA DE NAC[:\s]*([0-9.\/\- ]+)/);
  const sex = pull(/SEX[:\s]*([MFX])/, /GESLACHT[:\s]*([MVX])/, /SEXE[:\s]*([MFX])/);
  const issue = pull(/DATE OF ISSUE[:\s]*([0-9.\/\- ]+)/, /DATE D'EMISSION[:\s]*([0-9.\/\- ]+)/, /UITGIFTEDATUM[:\s]*([0-9.\/\- ]+)/);
  const expiry = pull(/DATE OF EXPIRY[:\s]*([0-9.\/\- ]+)/, /EXPIRATION[:\s]*([0-9.\/\- ]+)/, /VERVALDATUM[:\s]*([0-9.\/\- ]+)/);

  const natAlpha3 = t => {
    if (!t) return '';
    const T = t.replace(/[^A-Z ]/g, '').trim();
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
    passport_number: number ? number.replace(/\s+/g, '') : '',
    nationality_alpha3: natAlpha3(nat),
    issuing_country_alpha3: natAlpha3(nat), // Default to nationality if not explicitly stated
    birthday: formatDDMMYYYY(dob || '') || '',
    passport_issue_date: formatDDMMYYYY(issue || '') || '',
    passport_expiry_date: formatDDMMYYYY(expiry || '') || ''
  };
}

// Parse multipart form data
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: req.headers });
    const files = [];
    const fields = {};

    bb.on('file', (fieldname, file) => {
      const chunks = [];
      file.on('data', d => chunks.push(d));
      file.on('end', () => files.push(Buffer.concat(chunks)));
    });

    bb.on('field', (name, val) => {
      fields[name] = val;
    });

    bb.on('finish', () => resolve({ files, fields }));
    bb.on('error', reject);
    req.pipe(bb);
  });
}

/**
 * Main handler for /motherbrain/guest-intake endpoint
 */
async function handleMotherBrainGuestIntake(req, res) {
  try {
    // Parse multipart data
    const { files, fields } = await parseMultipart(req);

    if (!files || files.length === 0) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        ok: false,
        error: 'No images provided. Please upload at least one passport photo.'
      }));
      return;
    }

    // Extract optional fields
    const stay_id = fields._stay_id || null;
    const phone = fields._phone || null;
    const nickname = fields._nickname || null;
    const display_name = fields._display_name || null;
    const notes = fields._notes || null;

    // Process each passport image with Google Vision OCR
    const client = createVisionClient();
    const guests = [];
    const errors = [];

    for (let i = 0; i < files.length; i++) {
      try {
        const buf = files[i];
        const [result] = await client.documentTextDetection({ image: { content: buf } });
        const text = result?.fullTextAnnotation?.text || 
                    (result?.textAnnotations || []).map(a => a.description).join('\n') || '';

        if (!text || text.trim().length === 0) {
          errors.push({
            index: i,
            error: 'No text detected in image'
          });
          continue;
        }

        // Parse VIZ data from OCR text
        const fields = parseVIZ(text);

        // Validate required fields
        if (!fields.first_name && !fields.last_name) {
          errors.push({
            index: i,
            error: 'Could not extract name from passport',
            ocr_text_preview: text.substring(0, 200)
          });
          continue;
        }

        guests.push({
          first_name: fields.first_name || '',
          middle_name: fields.middle_name || '',
          last_name: fields.last_name || '',
          gender: fields.gender || '',
          nationality_alpha3: fields.nationality_alpha3 || '',
          issuing_country_alpha3: fields.issuing_country_alpha3 || '',
          birthday: fields.birthday || '',
          passport_number: fields.passport_number || '',
          passport_issue_date: fields.passport_issue_date || '',
          passport_expiry_date: fields.passport_expiry_date || ''
        });
      } catch (ocrError) {
        console.error(`OCR error for image ${i}:`, ocrError);
        errors.push({
          index: i,
          error: `OCR processing failed: ${ocrError.message}`
        });
      }
    }

    if (guests.length === 0) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        ok: false,
        error: 'No valid passport data extracted from images',
        errors
      }));
      return;
    }

    // Prepare SQL INSERT statement for MotherBrainGPT API
    // Build INSERT statements for each guest
    const insertStatements = guests.map((g, idx) => {
      const values = [
        stay_id ? `'${stay_id.replace(/'/g, "''")}'` : 'NULL',
        g.first_name ? `'${g.first_name.replace(/'/g, "''")}'` : 'NULL',
        g.middle_name ? `'${g.middle_name.replace(/'/g, "''")}'` : 'NULL',
        g.last_name ? `'${g.last_name.replace(/'/g, "''")}'` : 'NULL',
        g.gender ? `'${g.gender}'` : 'NULL',
        g.nationality_alpha3 ? `'${g.nationality_alpha3}'` : 'NULL',
        g.issuing_country_alpha3 ? `'${g.issuing_country_alpha3}'` : 'NULL',
        g.birthday ? `'${g.birthday}'::date` : 'NULL',
        g.passport_number ? `'${g.passport_number.replace(/'/g, "''")}'` : 'NULL',
        g.passport_issue_date ? `'${g.passport_issue_date}'::date` : 'NULL',
        g.passport_expiry_date ? `'${g.passport_expiry_date}'::date` : 'NULL',
        phone ? `'${phone.replace(/'/g, "''")}'` : 'NULL',
        nickname ? `'${nickname.replace(/'/g, "''")}'` : 'NULL',
        notes ? `'${notes.replace(/'/g, "''")}'` : 'NULL'
      ];
      return `(${values.join(', ')})`;
    }).join(',\n  ');

    const sql = `
INSERT INTO incoming_guests (
  stay_id, first_name, middle_name, last_name, gender,
  nationality_alpha3, issuing_country_alpha3, birthday,
  passport_number, passport_issue_date, passport_expiry_date,
  phone_e164, nickname, notes
)
VALUES
  ${insertStatements}
ON CONFLICT (stay_id, first_name)
DO UPDATE SET
  middle_name = COALESCE(EXCLUDED.middle_name, incoming_guests.middle_name),
  last_name = COALESCE(EXCLUDED.last_name, incoming_guests.last_name),
  gender = COALESCE(EXCLUDED.gender, incoming_guests.gender),
  nationality_alpha3 = COALESCE(EXCLUDED.nationality_alpha3, incoming_guests.nationality_alpha3),
  issuing_country_alpha3 = COALESCE(EXCLUDED.issuing_country_alpha3, incoming_guests.issuing_country_alpha3),
  birthday = COALESCE(EXCLUDED.birthday, incoming_guests.birthday),
  passport_number = COALESCE(EXCLUDED.passport_number, incoming_guests.passport_number),
  passport_issue_date = COALESCE(EXCLUDED.passport_issue_date, incoming_guests.passport_issue_date),
  passport_expiry_date = COALESCE(EXCLUDED.passport_expiry_date, incoming_guests.passport_expiry_date),
  phone_e164 = COALESCE(EXCLUDED.phone_e164, incoming_guests.phone_e164),
  nickname = COALESCE(EXCLUDED.nickname, incoming_guests.nickname),
  notes = COALESCE(EXCLUDED.notes, incoming_guests.notes),
  updated_at = NOW()
RETURNING id, stay_id, first_name, last_name;`;

    const motherbrainPayload = {
      arguments: {
        query: sql
      }
    };

    // Call MotherBrainGPT API with execute_sql tool
    const MOTHERBRAIN_API_URL = process.env.MOTHERBRAIN_API_URL || 
                                'https://supabase-mcp-fly.fly.dev/api/tools/execute_sql';
    const MOTHERBRAIN_API_KEY = process.env.MOTHERBRAIN_API_KEY;

    if (!MOTHERBRAIN_API_KEY) {
      console.error('MOTHERBRAIN_API_KEY not configured');
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        ok: false,
        error: 'MotherBrainGPT API key not configured',
        guests_parsed: guests.length,
        guests
      }));
      return;
    }

    // Debug logging (safe - no full key exposure)
    console.log('[MotherBrain Debug] API Key status:', MOTHERBRAIN_API_KEY ? '✅ present' : '❌ missing');
    console.log('[MotherBrain Debug] API Key prefix:', MOTHERBRAIN_API_KEY ? `${MOTHERBRAIN_API_KEY.slice(0, 10)}...` : 'N/A');
    console.log('[MotherBrain Debug] API URL:', MOTHERBRAIN_API_URL);
    console.log('[MotherBrain Debug] Payload guest count:', motherbrainPayload.guests.length);

    let apiResponse;
    try {
      const response = await fetch(MOTHERBRAIN_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${MOTHERBRAIN_API_KEY}`
        },
        body: JSON.stringify(motherbrainPayload)
      });

      const responseText = await response.text();
      
      if (!response.ok) {
        throw new Error(`MotherBrainGPT API returned ${response.status}: ${responseText}`);
      }

      try {
        apiResponse = JSON.parse(responseText);
      } catch {
        apiResponse = { raw: responseText };
      }
    } catch (apiError) {
      console.error('MotherBrainGPT API call failed:', apiError);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        ok: false,
        error: `Failed to send data to MotherBrainGPT: ${apiError.message}`,
        guests_parsed: guests.length,
        guests
      }));
      return;
    }

    // Success response
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: true,
      stay_id: stay_id,
      inserted: guests.length,
      message: 'Guests parsed and sent to MotherBrainGPT',
      guests,
      ocr_errors: errors.length > 0 ? errors : undefined,
      motherbrain_response: apiResponse
    }));

  } catch (err) {
    console.error('MotherBrain guest intake error:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      ok: false,
      error: err.message || 'Internal server error'
    }));
  }
}

module.exports = {
  handleMotherBrainGuestIntake
};
