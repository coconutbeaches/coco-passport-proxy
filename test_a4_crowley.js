#!/usr/bin/env node

// Test script to verify A4_Crowley passport data insertion

async function testA4Crowley() {
  console.log('Testing A4_Crowley passport insertion...\n');
  
  const payload = {
    "stay_id": "A4_Crowley",
    "mrz_list": [
      [
        "P<NLDVELEMA<<MARLOES<<<<<<<<<<<<<<<<<<<<<<<<<",
        "NX56DD9L50NLD7202010F3506189<<<<<<<<<<<<<<00"
      ],
      [
        "P<NLDVELEMA<<SANNE<LISA<<<<<<<<<<<<<<<<<<<<<<",
        "NMC7P6575NLD1406012F2908074<<<<<<<<<<<<<<06"
      ]
    ]
  };
  
  console.log('Sending payload to API:');
  console.log(JSON.stringify(payload, null, 2));
  console.log('\n');
  
  try {
    const response = await fetch('https://coco-passport-proxy.vercel.app/coco-gpt-batch-passport', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    console.log('API Response:');
    console.log(JSON.stringify(result, null, 2));
    
    // Now check Supabase directly
    console.log('\n\nChecking Supabase for the data...');
    
    const supabaseUrl = 'https://khmvuamdnsdmbbvwzbsr.supabase.co';
    const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtobXZ1YW1kbnNkbWJidnd6YnNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTY1Mzg0NTMsImV4cCI6MjAzMjExNDQ1M30.cz8bCFynibalonIVWqrYU4S5xKblJqDUyZNSGxE6dPM';
    
    // Check by passport numbers
    const checkResponse = await fetch(
      `${supabaseUrl}/rest/v1/incoming_guests?or=(passport_number.eq.NX56DD9L5,passport_number.eq.NMC7P6575)&select=*`,
      {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`
        }
      }
    );
    
    const data = await checkResponse.json();
    console.log('Found in database:');
    console.log(JSON.stringify(data, null, 2));
    
    if (data.length === 0) {
      console.log('\nNo data found! Checking by stay_id...');
      
      const checkByStayId = await fetch(
        `${supabaseUrl}/rest/v1/incoming_guests?stay_id=eq.A4_Crowley&select=stay_id,first_name,middle_name,last_name,passport_number,created_at`,
        {
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`
          }
        }
      );
      
      const stayData = await checkByStayId.json();
      console.log('Data for stay_id A4_Crowley:');
      console.log(JSON.stringify(stayData, null, 2));
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testA4Crowley();
