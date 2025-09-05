# Passport Image Upload Endpoint

## New Endpoint: `/passport-images`

### Purpose
Accept passport images directly from CocoGPT and handle all OCR/MRZ extraction server-side.

### Request Format
```
POST /passport-images
Content-Type: multipart/form-data

Fields:
- stay_id: string (required) - e.g., "B7_Kislinger"
- images[]: file (required) - passport image files (JPEG/PNG)
```

### Alternative JSON Format (Base64)
```json
POST /passport-images
Content-Type: application/json

{
  "stay_id": "B7_Kislinger",
  "images": [
    {
      "filename": "passport1.jpg",
      "content_type": "image/jpeg",
      "data": "base64_encoded_image_data_here..."
    },
    {
      "filename": "passport2.jpg", 
      "content_type": "image/jpeg",
      "data": "base64_encoded_image_data_here..."
    }
  ]
}
```

### Server Processing Flow
1. Receive images
2. Run OCR (Tesseract or cloud OCR service)
3. Extract MRZ lines
4. Parse MRZ data
5. If MRZ unclear, try human-readable extraction
6. Store in database
7. Return results

### Response Format
```json
{
  "success": true,
  "stay_id": "B7_Kislinger",
  "summary": {
    "total_images": 2,
    "processed": 2,
    "failed": 0
  },
  "results": [
    {
      "image": "passport1.jpg",
      "status": "success",
      "extracted": {
        "first_name": "Stefan",
        "last_name": "Kislinger",
        "passport_number": "P123456789",
        "nationality": "DEU"
      },
      "action": "merged"
    }
  ],
  "errors": []
}
```

### Benefits
1. **Simpler for CocoGPT** - Just forward images
2. **No MRZ construction needed** - Server handles it
3. **Better error handling** - Server can retry OCR with different settings
4. **Consistent processing** - One OCR implementation
5. **Easier debugging** - Can log/save problematic images

### Implementation Requirements

#### Server Dependencies
```javascript
// Required packages
const multer = require('multer'); // For multipart uploads
const sharp = require('sharp'); // Image processing
const tesseract = require('node-tesseract-ocr'); // OCR
// OR
const vision = require('@google-cloud/vision'); // Google Cloud Vision API
```

#### OCR Configuration
```javascript
const ocrConfig = {
  lang: 'eng',
  oem: 1,
  psm: 3,
  tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<',
  tessedit_ocr_engine_mode: 1
};
```

### CocoGPT Instructions Update

Instead of:
```
1. Extract MRZ from image
2. Build JSON with MRZ data
3. Call API
```

New flow:
```
1. Get stay_id from user
2. Get passport image(s)
3. POST images to /passport-images
4. Return server response
```

### Example CocoGPT Code
```python
import requests

def process_passports(stay_id, image_files):
    files = [
        ('images', (f.name, f.read(), 'image/jpeg'))
        for f in image_files
    ]
    
    response = requests.post(
        'https://coco-passport-proxy.vercel.app/passport-images',
        data={'stay_id': stay_id},
        files=files
    )
    
    return response.json()
```

### Security Considerations
1. **File size limits** - Max 10MB per image
2. **File type validation** - Only JPEG/PNG
3. **Rate limiting** - Max 10 images per request
4. **Virus scanning** - Optional for production
5. **Image storage** - Store temporarily for debugging, delete after processing

### Error Scenarios
```json
{
  "success": false,
  "error": "OCR failed on passport1.jpg - image too blurry",
  "suggestions": [
    "Please upload a clearer image",
    "Ensure good lighting",
    "Avoid shadows on the MRZ area"
  ]
}
```

### Migration Path
1. Keep existing `/coco-gpt-batch-passport` endpoint
2. Add new `/passport-images` endpoint
3. Update CocoGPT to use new endpoint
4. Phase out MRZ extraction from CocoGPT
5. Eventually deprecate old endpoint

### Advantages Over Current System
| Current (MRZ in CocoGPT) | New (Images to Server) |
|--------------------------|------------------------|
| CocoGPT does OCR | Server does OCR |
| Plugin tool issues | Direct HTTP upload |
| Complex instructions | Simple: "send images" |
| Client-side MRZ building | Server-side processing |
| Limited OCR options | Can use multiple OCR engines |
| Hard to debug | Can save/review images |
