#!/usr/bin/env node

/**
 * Example: Add passport guests to an existing stay
 * 
 * This demonstrates the simplified workflow for adding passport data
 * to the incoming_guests table without updating the booking row.
 */

const PASSPORT_PROXY_URL = process.env.PASSPORT_PROXY_BASE_URL || 'https://coco-passport-proxy.vercel.app';

async function addPassportGuests() {
  const payload = {
    stay_id: "A6_CHRISTEN",
    guests: [
      {
        first_name: "John",
        middle_name: "",
        last_name: "Smith",
        gender: "M",
        passport_number: "123456789",
        nationality_alpha3: "USA",
        issuing_country_alpha3: "USA",
        birthday: "1990-01-15",
        passport_issue_date: "2020-01-01",
        passport_expiry_date: "2030-01-01"
      },
      {
        first_name: "Jane",
        middle_name: "Marie",
        last_name: "Smith",
        gender: "F",
        passport_number: "987654321",
        nationality_alpha3: "USA",
        issuing_country_alpha3: "USA",
        birthday: "1992-03-20",
        passport_issue_date: "2021-05-15",
        passport_expiry_date: "2031-05-15"
      }
    ]
  };

  console.log('Adding passport guests to stay:', payload.stay_id);
  console.log('Number of guests:', payload.guests.length);
  console.log('\n');

  try {
    const response = await fetch(`${PASSPORT_PROXY_URL}/add-passport-guests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Error response:', result);
      process.exit(1);
    }

    console.log('✅ Success!');
    console.log('Inserted guests:', result.inserted);
    console.log('\nGuest details:');
    result.guests.forEach((guest, i) => {
      console.log(`  ${i + 1}. ${guest.first_name} ${guest.last_name} - Passport: ${guest.passport_number}`);
    });

    if (result.errors && result.errors.length > 0) {
      console.log('\n⚠️  Errors occurred:');
      result.errors.forEach((err, i) => {
        console.log(`  ${i + 1}. Index ${err.index}: ${err.error}`);
      });
    }

  } catch (err) {
    console.error('Request failed:', err.message);
    process.exit(1);
  }
}

// Example with international characters (will be normalized)
async function addInternationalGuests() {
  const payload = {
    stay_id: "A4_HANSEN",
    guests: [
      {
        first_name: "Søren",       // ø → o
        middle_name: "",
        last_name: "Hansen",
        gender: "M",
        passport_number: "DK123456",
        nationality_alpha3: "DNK",
        issuing_country_alpha3: "DNK",
        birthday: "1985-06-12",
        passport_issue_date: "2019-01-01",
        passport_expiry_date: "2029-01-01"
      },
      {
        first_name: "François",    // ç → c
        middle_name: "",
        last_name: "Müller",       // ü → u
        gender: "M",
        passport_number: "FR789012",
        nationality_alpha3: "FRA",
        issuing_country_alpha3: "FRA",
        birthday: "1988-09-25",
        passport_issue_date: "2020-03-15",
        passport_expiry_date: "2030-03-15"
      }
    ]
  };

  console.log('\n--- International Characters Example ---');
  console.log('Adding guests with special characters...');
  console.log('Note: ø→o, ü→u, ç→c will be automatically normalized\n');

  try {
    const response = await fetch(`${PASSPORT_PROXY_URL}/add-passport-guests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (response.ok) {
      console.log('✅ International guests added successfully!');
      console.log('Inserted:', result.inserted);
      result.guests.forEach(g => {
        console.log(`  - ${g.first_name} ${g.last_name}`);
      });
    } else {
      console.error('Error:', result.error);
    }

  } catch (err) {
    console.error('Request failed:', err.message);
  }
}

// Run examples
if (require.main === module) {
  (async () => {
    await addPassportGuests();
    await addInternationalGuests();
  })();
}

module.exports = { addPassportGuests, addInternationalGuests };
