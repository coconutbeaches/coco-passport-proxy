#!/usr/bin/env node

// Test MRZ parsing for SANNE's passport

function parseMRZ(mrzString) {
  if (!mrzString || typeof mrzString !== 'string') {
    return { valid: false, error: 'Invalid MRZ string' };
  }
  
  const lines = mrzString.split('\n').map(line => line.trim());
  
  if (lines.length >= 2) {
    const line1 = lines[0];
    const line2 = lines[1];
    
    console.log('Line 1:', line1);
    console.log('Line 2:', line2);
    console.log('Line 2 length:', line2.length);
    
    // Extract passport number (positions 0-8)
    const passportNumber = line2.substring(0, 9).replace(/<+$/, '');
    console.log('Passport number (pos 0-8):', passportNumber);
    
    // Extract nationality (positions 10-12)
    const nationality = line2.substring(10, 13);
    console.log('Nationality (pos 10-12):', nationality);
    
    // Extract birthdate (positions 13-18)
    const birthdateStr = line2.substring(13, 19);
    console.log('Birthdate string (pos 13-18):', birthdateStr);
    
    // Position 20 for gender
    const genderChar = line2.charAt(20);
    console.log('Gender char (pos 20):', genderChar);
    
    // Extract expiry date (positions 21-26)
    const expiryStr = line2.substring(21, 27);
    console.log('Expiry string (pos 21-26):', expiryStr);
    
    // Parse birthdate
    if (/^\d{6}$/.test(birthdateStr)) {
      const year = parseInt(birthdateStr.substring(0, 2));
      const month = parseInt(birthdateStr.substring(2, 4));
      const day = parseInt(birthdateStr.substring(4, 6));
      
      // Convert 2-digit year to 4-digit
      const currentYear = new Date().getFullYear();
      const currentCentury = Math.floor(currentYear / 100) * 100;
      const fullYear = year <= (currentYear % 100) ? currentCentury + year : (currentCentury - 100) + year;
      
      console.log(`Parsed birthdate: ${fullYear}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`);
    }
    
    // Extract names from line 1
    const nameSection = line1.substring(5).replace(/<{2,}/g, '|');
    console.log('Name section:', nameSection);
    const nameParts = nameSection.split('|').filter(Boolean);
    console.log('Name parts:', nameParts);
  }
}

// Test MARLOES
console.log('=== TESTING MARLOES ===');
parseMRZ('P<NLDVELEMA<<MARLOES<<<<<<<<<<<<<<<<<<<<<<<<<\nNX56DD9L50NLD7202010F3506189<<<<<<<<<<<<<<00');

console.log('\n=== TESTING SANNE ===');
parseMRZ('P<NLDVELEMA<<SANNE<LISA<<<<<<<<<<<<<<<<<<<<<<\nNMC7P6575NLD1406012F2908074<<<<<<<<<<<<<<06');
