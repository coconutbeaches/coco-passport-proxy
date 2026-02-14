// Test script to verify stay_id preservation
async function testStayId() {
  const testCases = [
    { stay_id: 'NH_MANTEL', name: 'Test_NH' },
    { stay_id: 'A5_MANTEL', name: 'Test_A5' },
    { stay_id: 'NH_Mantel', name: 'Test_NH_Mixed' },
    { stay_id: 'BEACHHOUSE_TEST', name: 'Test_BeachHouse' }
  ];

  for (const testCase of testCases) {
    console.log(`\n\nTesting stay_id: "${testCase.stay_id}"`);
    console.log('='.repeat(50));

    try {
      const response = await fetch('https://coco-passport-proxy.vercel.app/add-passport-guests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stay_id: testCase.stay_id,
          guests: [{
            first_name: testCase.name,
            last_name: 'TestUser',
            passport_number: `TEST${Date.now()}`
          }]
        })
      });

      const result = await response.json();

      if (result.ok) {
        console.log('✅ Insert successful');
        console.log(`   Input stay_id:  "${testCase.stay_id}"`);
        console.log(`   Output stay_id: "${result.stay_id}"`);
        console.log(`   Match: ${testCase.stay_id === result.stay_id ? 'YES ✓' : 'NO ✗'}`);

        if (testCase.stay_id !== result.stay_id) {
          console.log(`   ⚠️  TRANSFORMATION DETECTED!`);
          console.log(`   "${testCase.stay_id}" → "${result.stay_id}"`);
        }
      } else {
        console.log('❌ Insert failed:', result.error);
        if (result.errors) {
          console.log('   Errors:', JSON.stringify(result.errors, null, 2));
        }
      }
    } catch (err) {
      console.log('❌ Request failed:', err.message);
    }
  }
}

testStayId().catch(console.error);
