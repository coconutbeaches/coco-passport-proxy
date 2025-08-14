#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

// Function to execute migration via Supabase REST API using SQL
async function runMigrationViaREST() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing required environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    console.log('These should be available in your Vercel environment or local .env file');
    process.exit(1);
  }

  console.log('🔄 Running migration via Supabase REST API...');
  
  // Read the migration SQL file
  const migrationSQL = fs.readFileSync(path.join(__dirname, 'add_missing_columns_migration.sql'), 'utf8');
  
  try {
    // Execute the migration by calling a simple query first to test connection
    const testResponse = await fetch(`${SUPABASE_URL}/rest/v1/rpc/version`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!testResponse.ok) {
      throw new Error(`Connection test failed: ${testResponse.status} ${testResponse.statusText}`);
    }

    console.log('✅ Connected to Supabase successfully');
    console.log('');
    console.log('🚨 MANUAL MIGRATION REQUIRED 🚨');
    console.log('');
    console.log('The migration SQL has been prepared but cannot be executed automatically');
    console.log('due to Supabase REST API limitations for DDL operations.');
    console.log('');
    console.log('Please follow these steps:');
    console.log('');
    console.log('1. Go to your Supabase project dashboard');
    console.log('2. Navigate to SQL Editor');
    console.log('3. Open the file: add_missing_columns_migration.sql');
    console.log('4. Copy and paste the SQL content');
    console.log('5. Execute the migration');
    console.log('');
    console.log('The migration script is idempotent (safe to run multiple times)');
    console.log('and will only add columns that don\'t already exist.');
    console.log('');
    console.log('Migration file location: ' + path.join(__dirname, 'add_missing_columns_migration.sql'));

  } catch (error) {
    console.error('❌ Failed to connect to Supabase:', error.message);
    console.log('');
    console.log('Please check your environment variables and run the migration manually in Supabase SQL Editor.');
  }
}

// Function to execute migration via direct PostgreSQL connection
async function runMigrationViaPostgreSQL() {
  const { DATABASE_URL } = process.env;
  
  if (!DATABASE_URL) {
    console.error('❌ Missing DATABASE_URL environment variable');
    return;
  }

  console.log('🔄 Running migration via direct PostgreSQL connection...');
  
  try {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });

    const migrationSQL = fs.readFileSync(path.join(__dirname, 'add_missing_columns_migration.sql'), 'utf8');
    
    const client = await pool.connect();
    
    try {
      await client.query(migrationSQL);
      console.log('✅ Migration executed successfully!');
    } finally {
      client.release();
      await pool.end();
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.log('');
    console.log('Please run the migration manually in Supabase SQL Editor.');
  }
}

// Main execution
async function main() {
  console.log('🚀 Starting database migration for incoming_guests table');
  console.log('');
  
  // Check if pg module is available for direct PostgreSQL connection
  try {
    require.resolve('pg');
    await runMigrationViaPostgreSQL();
  } catch (error) {
    console.log('ℹ️  PostgreSQL module not available, trying REST API method...');
    console.log('');
    await runMigrationViaREST();
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };
