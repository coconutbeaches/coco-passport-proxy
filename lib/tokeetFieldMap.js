/**
 * Centralized Tokeet CSV to Database field mapping configuration
 * This file serves as the single source of truth for mapping Tokeet CSV fields 
 * to database columns, shared between the CSV parser and /tokeet-upsert endpoint.
 * 
 * Based on tokeet_csv_to_db_mapping.csv analysis
 * @module tokeetFieldMap
 */

/**
 * @typedef {Object} FieldMapping
 * @property {string|null} dbField - The target database column name, null if field should be skipped
 * @property {string|null} parser - The type parser to use for coercion ('string', 'integer', 'numeric', 'date', 'time', 'array', or null)
 * @property {string} [notes] - Additional notes about the field mapping or processing requirements
 */

/**
 * CSV to Database field mapping configuration
 * Maps Tokeet CSV column names to database fields with type information
 * 
 * @type {Object<string, FieldMapping>}
 */
const CSV_TO_DB_MAPPING = {
  // Core guest information
  'Name': { 
    dbField: 'name_full', 
    parser: 'string',
    notes: 'Will be split into first_name, middle_name, last_name during processing'
  },
  'Email': { 
    dbField: 'email', 
    parser: 'string' 
  },
  'Guest Secondary Emails': { 
    dbField: 'secondary_emails', 
    parser: 'array',
    notes: 'Comma-separated or JSON array format'
  },
  
  // Contact information
  'Telephone': { 
    dbField: 'phone_e164', 
    parser: 'string',
    notes: 'May need E.164 formatting transformation'
  },
  'Guest Secondary Phones': { 
    dbField: 'secondary_phones', 
    parser: 'array',
    notes: 'Comma-separated or JSON array format'
  },
  'Guest Address': { 
    dbField: 'guest_address', 
    parser: 'string' 
  },
  
  // Booking information
  'Booking Status': { 
    dbField: 'booking_status', 
    parser: 'string' 
  },
  'Rental': { 
    dbField: 'rental_unit', 
    parser: 'string',
    notes: 'Used to extract rental_units array and generate stay_id'
  },
  'Arrive': { 
    dbField: 'check_in_date', 
    parser: 'date' 
  },
  'Depart': { 
    dbField: 'check_out_date', 
    parser: 'date' 
  },
  'Nights': { 
    dbField: 'nights', 
    parser: 'integer' 
  },
  'Received': { 
    dbField: 'date_received', 
    parser: 'date' 
  },
  'Checkin': { 
    dbField: 'checkin_time', 
    parser: 'time' 
  },
  'Checkout': { 
    dbField: 'checkout_time', 
    parser: 'time' 
  },
  
  // Booking identifiers
  'Booking ID': { 
    dbField: 'booking_id', 
    parser: 'string' 
  },
  'Inquiry ID': { 
    dbField: 'inquiry_id', 
    parser: 'string' 
  },
  'Source': { 
    dbField: 'booking_channel', 
    parser: 'string' 
  },
  'Booked': { 
    dbField: null, 
    parser: null,
    notes: 'Boolean field not stored in DB, used for processing logic only'
  },
  
  // Guest counts and pricing
  'Adults': { 
    dbField: 'adults', 
    parser: 'integer' 
  },
  'Children': { 
    dbField: 'children', 
    parser: 'integer' 
  },
  'Currency': { 
    dbField: 'currency', 
    parser: 'string',
    notes: 'Limited to 3 characters in database'
  },
  'Total Cost': { 
    dbField: 'total_cost', 
    parser: 'numeric' 
  },
  'Base Rate': { 
    dbField: 'base_rate', 
    parser: 'numeric' 
  },
  'Tax': { 
    dbField: 'tax', 
    parser: 'numeric' 
  },
  'Booking Formula': { 
    dbField: 'booking_formula', 
    parser: 'string' 
  },
  'Guest ID': { 
    dbField: 'guest_id', 
    parser: 'string' 
  }
};

/**
 * Get list of all supported Tokeet CSV field names
 * @returns {string[]} Array of supported CSV field names
 */
function getSupportedFields() {
  return Object.keys(CSV_TO_DB_MAPPING);
}

/**
 * Get list of all target database column names (excluding null mappings)
 * @returns {string[]} Array of database column names
 */
function getTargetColumns() {
  return Object.values(CSV_TO_DB_MAPPING)
    .filter(mapping => mapping.dbField !== null)
    .map(mapping => mapping.dbField);
}

/**
 * Get mapping configuration for a specific CSV field
 * @param {string} csvField - The CSV field name
 * @returns {FieldMapping|undefined} The field mapping configuration or undefined if not found
 */
function getFieldMapping(csvField) {
  return CSV_TO_DB_MAPPING[csvField];
}

/**
 * Check if a CSV field is supported
 * @param {string} csvField - The CSV field name to check
 * @returns {boolean} True if the field is supported
 */
function isFieldSupported(csvField) {
  return csvField in CSV_TO_DB_MAPPING;
}

/**
 * Default values applied to all processed records
 * These are system fields set during processing
 */
const DEFAULT_RECORD_VALUES = {
  source: 'tokeet_feed',
  row_type: 'booking',
  status: 'pending_review',
  photo_urls: []
};

module.exports = {
  CSV_TO_DB_MAPPING,
  DEFAULT_RECORD_VALUES,
  getSupportedFields,
  getTargetColumns,
  getFieldMapping,
  isFieldSupported
};
