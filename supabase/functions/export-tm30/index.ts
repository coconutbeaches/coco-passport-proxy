// supabase/functions/export-tm30/index.ts
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import * as XLSX from 'https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs'

// Function to remove diacritics (accents) from text
function removeDiacritics(str: string): string {
  if (!str) return ''
  
  // Normalize to NFD (decomposed form) then remove combining diacritical marks
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

// Function to sanitize names for TM30 format
function sanitizeName(name: string): string {
  if (!name) return ''
  
  // Remove diacritics first
  let sanitized = removeDiacritics(name)
  
  // Replace hyphens and dashes with spaces
  sanitized = sanitized.replace(/[-–—]/g, ' ')
  
  // Clean up multiple spaces
  sanitized = sanitized.replace(/\s+/g, ' ').trim()
  
  return sanitized
}

serve(async (req) => {
  try {
    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // TM30 Column headers exactly as required
    const TM30_HEADERS = [
      'ชื่อ\nFirst Name *',
      'ชื่อกลาง\nMiddle Name',
      'นามสกุล\nLast Name',
      'เพศ\nGender *',
      'เลขหนังสือเดินทาง\nPassport No. *',
      'สัญชาติ\nNationality *',
      'วัน เดือน ปี เกิด\nBirth Date\nDD/MM/YYYY(ค.ศ. / A.D.) \nเช่น 17/06/1985 หรือ 10/00/1985 หรือ 00/00/1985',
      'วันที่แจ้งออกจากที่พัก\nCheck-out Date\nDD/MM/YYYY(ค.ศ. / A.D.) \nเช่น 14/06/2023',
      'เบอร์โทรศัพท์\nPhone No.'
    ]

    // Fetch data from incoming_guests
    // Filter: Only guests with passport numbers AND created in the last 24 hours
    const now = new Date()
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    
    const { data: guests, error } = await supabaseClient
      .from('incoming_guests')
      .select(`
        first_name,
        middle_name,
        last_name,
        gender,
        passport_number,
        nationality_alpha3,
        birthday,
        check_out_date,
        phone_e164,
        created_at
      `)
      .not('passport_number', 'is', null)  // Must have passport number
      .neq('passport_number', '')          // Passport number must not be empty
      .gte('created_at', twentyFourHoursAgo.toISOString())  // Created in last 24 hours
      .order('created_at', { ascending: false })

    if (error) throw error

    // Transform data to TM30 format
    const tm30Data = guests.map(guest => {
      // Format birthday from YYYY-MM-DD to DD/MM/YYYY
      let formattedBirthday = ''
      if (guest.birthday) {
        const [year, month, day] = guest.birthday.split('-')
        formattedBirthday = `${day}/${month}/${year}`
      }

      // Format checkout date
      let formattedCheckout = ''
      if (guest.check_out_date) {
        const [year, month, day] = guest.check_out_date.split('-')
        formattedCheckout = `${day}/${month}/${year}`
      }

      return [
        sanitizeName(guest.first_name) || '',
        sanitizeName(guest.middle_name) || '',
        sanitizeName(guest.last_name) || '',
        guest.gender || '',
        guest.passport_number || '',
        guest.nationality_alpha3 || '',
        formattedBirthday,
        formattedCheckout,
        guest.phone_e164 || ''
      ]
    })

    // Create workbook with exact TM30 format
    const wb = XLSX.utils.book_new()
    
    // Add header row and data
    const wsData = [TM30_HEADERS, ...tm30Data]
    
    // Create worksheet
    const ws = XLSX.utils.aoa_to_sheet(wsData)
    
    // Set column widths for better readability
    ws['!cols'] = [
      { wch: 15 }, // First Name
      { wch: 15 }, // Middle Name
      { wch: 15 }, // Last Name
      { wch: 10 }, // Gender
      { wch: 20 }, // Passport No
      { wch: 15 }, // Nationality
      { wch: 40 }, // Birth Date (long due to Thai text)
      { wch: 40 }, // Check-out Date
      { wch: 20 }  // Phone No
    ]

    // Add worksheets with Thai names
    XLSX.utils.book_append_sheet(wb, ws, 'แบบแจ้งที่พัก Inform Accom')
    

    // Generate XLSX buffer
    const xlsxBuffer = XLSX.write(wb, { 
      type: 'buffer', 
      bookType: 'xlsx',
      compression: true // Enable compression for smaller files
    })

    // Generate filename with date
    const dateStr = now.toISOString().split('T')[0]
    const filename = `TM30_Immigration_${dateStr}.xlsx`

    // Save to Supabase Storage
    const { error: uploadError } = await supabaseClient.storage
      .from('tm30-exports')
      .upload(`daily/${filename}`, xlsxBuffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        upsert: true // Overwrite if exists
      })

    if (uploadError) throw uploadError

    // Generate signed URL for download (optional)
    const { data: urlData } = await supabaseClient.storage
      .from('tm30-exports')
      .createSignedUrl(`daily/${filename}`, 3600) // 1 hour expiry

    // Clean up old exports (keep last 30 days)
    await cleanupOldExports(supabaseClient)

    return new Response(
      JSON.stringify({ 
        success: true,
        filename,
        records: tm30Data.length,
        downloadUrl: urlData?.signedUrl,
        message: `TM30 export completed with ${tm30Data.length} guests`
      }),
      { 
        headers: { 
          "Content-Type": "application/json",
          "Cache-Control": "no-cache"
        } 
      }
    )
  } catch (error) {
    console.error('TM30 Export error:', error)
    
    // Send alert to monitoring
    await sendErrorAlert(error)
    
    return new Response(
      JSON.stringify({ 
        error: error.message,
        timestamp: new Date().toISOString()
      }),
      { 
        status: 500, 
        headers: { "Content-Type": "application/json" } 
      }
    )
  }
})

async function cleanupOldExports(supabase: any) {
  try {
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    
    const { data: files } = await supabase.storage
      .from('tm30-exports')
      .list('daily', { limit: 100 })
    
    if (files) {
      const oldFiles = files
        .filter(file => {
          const fileDate = file.name.match(/(\d{4}-\d{2}-\d{2})/)?.[1]
          return fileDate && new Date(fileDate) < thirtyDaysAgo
        })
        .map(file => `daily/${file.name}`)
      
      if (oldFiles.length > 0) {
        await supabase.storage
          .from('tm30-exports')
          .remove(oldFiles)
        console.log(`Cleaned up ${oldFiles.length} old exports`)
      }
    }
  } catch (error) {
    console.error('Cleanup error:', error)
  }
}

async function sendErrorAlert(error: any) {
  // Implement your alerting mechanism here
  // Could be email, Slack, Discord, etc.
  console.error('Alert: TM30 export failed:', error.message)
}
