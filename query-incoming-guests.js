#!/usr/bin/env node

async function queryIncomingGuests() {
  console.log('🔍 Querying incoming_guests table...');
  
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ Missing required environment variables:');
    console.error('- SUPABASE_URL:', SUPABASE_URL ? 'set' : 'NOT SET');
    console.error('- SUPABASE_SERVICE_ROLE_KEY:', SUPABASE_SERVICE_ROLE_KEY ? 'set' : 'NOT SET');
    console.log('\nPlease set these environment variables to query the database.');
    process.exit(1);
  }

  // Calculate tomorrow's date
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0]; // YYYY-MM-DD format
  
  console.log(`Querying for check-in date: ${tomorrowStr}`);

  try {
    const baseHeaders = {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      'Accept-Profile': 'public',
      'Content-Profile': 'public'
    };

    // Query for tomorrow's guests
    const query = `check_in_date=eq.${tomorrowStr}`;
    const selectFields = 'email,phone_e164,rental_unit,first_name,last_name,booking_status,check_in_date,check_out_date,stay_id,source,created_at';
    
    const url = `${SUPABASE_URL}/rest/v1/incoming_guests?${query}&select=${selectFields}&order=created_at.desc`;
    
    console.log(`\nQuerying: ${url}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: baseHeaders
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Query failed: ${response.status} ${response.statusText}\n${errorText}`);
    }

    const guests = await response.json();
    
    console.log(`\n✅ Query successful! Found ${guests.length} guests checking in tomorrow.`);
    
    if (guests.length === 0) {
      console.log('\nNo guests found for tomorrow. This could mean:');
      console.log('1. The tokeet-upsert hasn\'t been run yet');
      console.log('2. There are no bookings for tomorrow');
      console.log('3. The data is using a different date format');
      
      // Try querying recent records to verify the table has data
      console.log('\nQuerying recent records to verify table has data...');
      const recentUrl = `${SUPABASE_URL}/rest/v1/incoming_guests?select=${selectFields}&order=created_at.desc&limit=5`;
      const recentResponse = await fetch(recentUrl, { headers: baseHeaders });
      
      if (recentResponse.ok) {
        const recentGuests = await recentResponse.json();
        console.log(`Found ${recentGuests.length} recent records in the table:`);
        recentGuests.forEach((guest, index) => {
          console.log(`  ${index + 1}. ${guest.first_name} ${guest.last_name} - Check-in: ${guest.check_in_date} (${guest.rental_unit})`);
        });
      }
    } else {
      console.log('\n📋 Guest Details:');
      console.log('================');
      
      guests.forEach((guest, index) => {
        console.log(`\n${index + 1}. ${guest.first_name} ${guest.last_name}`);
        console.log(`   📧 Email: ${guest.email || 'N/A'}`);
        console.log(`   📞 Phone: ${guest.phone_e164 || 'N/A'}`);
        console.log(`   🏠 Rental Unit: ${guest.rental_unit || 'N/A'}`);
        console.log(`   📅 Check-in: ${guest.check_in_date}`);
        console.log(`   📅 Check-out: ${guest.check_out_date || 'N/A'}`);
        console.log(`   🆔 Stay ID: ${guest.stay_id || 'N/A'}`);
        console.log(`   📊 Status: ${guest.booking_status || 'N/A'}`);
        console.log(`   🔄 Source: ${guest.source || 'N/A'}`);
        console.log(`   ⏰ Created: ${new Date(guest.created_at).toLocaleString()}`);
      });

      // Verify all essential columns are populated
      console.log('\n🔍 Column Population Analysis:');
      console.log('=============================');
      
      const columnStats = {
        email: guests.filter(g => g.email).length,
        phone_e164: guests.filter(g => g.phone_e164).length,
        rental_unit: guests.filter(g => g.rental_unit).length,
        first_name: guests.filter(g => g.first_name).length,
        last_name: guests.filter(g => g.last_name).length,
        stay_id: guests.filter(g => g.stay_id).length,
        booking_status: guests.filter(g => g.booking_status).length
      };
      
      Object.entries(columnStats).forEach(([column, count]) => {
        const percentage = ((count / guests.length) * 100).toFixed(1);
        const status = count === guests.length ? '✅' : count > 0 ? '⚠️' : '❌';
        console.log(`   ${status} ${column}: ${count}/${guests.length} (${percentage}%)`);
      });

      // Check for any runtime errors or cast issues
      console.log('\n🚨 Potential Issues Check:');
      console.log('=========================');
      
      const issues = [];
      
      guests.forEach((guest, index) => {
        if (!guest.email && !guest.phone_e164) {
          issues.push(`Guest ${index + 1} (${guest.first_name} ${guest.last_name}): No contact info`);
        }
        if (!guest.rental_unit) {
          issues.push(`Guest ${index + 1} (${guest.first_name} ${guest.last_name}): Missing rental unit`);
        }
        if (!guest.stay_id) {
          issues.push(`Guest ${index + 1} (${guest.first_name} ${guest.last_name}): Missing stay_id`);
        }
      });
      
      if (issues.length === 0) {
        console.log('   ✅ No issues detected - all essential columns populated');
      } else {
        console.log(`   ❌ Found ${issues.length} issues:`);
        issues.forEach(issue => console.log(`      • ${issue}`));
      }
    }

  } catch (error) {
    console.error('❌ Error querying database:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the query
if (require.main === module) {
  queryIncomingGuests();
}

module.exports = { queryIncomingGuests };
