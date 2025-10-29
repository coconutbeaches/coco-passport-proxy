# MotherBrain Integration - Quick Start

## 🚀 5-Minute Setup

### 1. Set Environment Variable

Add to Vercel dashboard or `.env.local`:

```bash
MOTHERBRAIN_API_KEY=your_actual_api_key_here
```

### 2. Deploy (if using Vercel)

```bash
vercel --prod
```

### 3. Test Locally (Optional)

```bash
# Start server
node index.js

# In another terminal, test with a passport image:
curl -X POST http://localhost:3000/motherbrain/guest-intake \
  -F "images=@/path/to/passport.jpg" \
  -F "_stay_id=A5_Test" \
  -F "_phone=+66812345678"
```

## 📝 Basic Usage

### Single Passport Upload

```bash
curl -X POST https://coco-passport-proxy.vercel.app/motherbrain/guest-intake \
  -F "images=@passport.jpg" \
  -F "_stay_id=A5_Crowley"
```

### Multiple Passports (Family)

```bash
curl -X POST https://coco-passport-proxy.vercel.app/motherbrain/guest-intake \
  -F "images=@dad_passport.jpg" \
  -F "images=@mom_passport.jpg" \
  -F "images=@child_passport.jpg" \
  -F "_stay_id=B7_Smith" \
  -F "_phone=+1234567890" \
  -F "_notes=Family of 3, arriving Dec 25"
```

## 📤 Expected Response

```json
{
  "ok": true,
  "stay_id": "A5_Crowley",
  "inserted": 1,
  "message": "Guests parsed and sent to MotherBrainGPT",
  "guests": [
    {
      "first_name": "Tyler",
      "last_name": "Crowley",
      "gender": "M",
      "nationality_alpha3": "USA",
      "birthday": "1990-05-15",
      "passport_number": "123456789"
    }
  ],
  "motherbrain_response": {
    "success": true
  }
}
```

## 🎯 What It Does

1. **Receives** passport photo(s) via multipart upload
2. **Extracts** structured data using Google Vision OCR:
   - Name (first, middle, last)
   - Passport number
   - Nationality (3-letter code)
   - Gender (M/F/X)
   - Birthday
   - Issue/expiry dates
3. **Sends** to MotherBrainGPT API for guest record creation
4. **Returns** OCR results + API response

## 🛠️ Troubleshooting

### "MOTHERBRAIN_API_KEY not configured"
→ Add the environment variable to Vercel or `.env.local`

### "No text detected in image"
→ Ensure passport is clearly visible, well-lit, and in focus

### "Could not extract name from passport"
→ Try a clearer photo or verify it's the data page of the passport

## 📚 Full Documentation

For complete API specification, examples, and integration guide:
- See `MOTHERBRAIN_INTEGRATION.md`
- See `IMPLEMENTATION_SUMMARY.md`

## 🧪 Test Script

Use the provided test script for quick testing:

```bash
./test-motherbrain-intake.sh
```

## 🎉 That's It!

The endpoint is now ready to process passport uploads and sync with MotherBrainGPT.
