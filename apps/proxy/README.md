# Passport OCR Proxy API

Vercel serverless proxy for the OCR service running on Google Cloud Run. Provides a unified API endpoint for passport processing.

## Environment Variables

Required environment variables in Vercel:

| Variable | Description | Example |
|----------|-------------|---------|
| `OCR_SERVICE_URL` | OCR service URL | `https://coco-passport-ocr-xxx.run.app/passport-ocr` |
| `OCR_SERVICE_TOKEN` | Authentication token | `xxx` |

## API Routes

### POST /api/passport-ocr

Proxy endpoint that forwards requests to the OCR service.

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- Body: Same as OCR service
  - `images`: List of passport image files
  - `default_checkout`: Optional default checkout date

**Response:** 
- Exactly as returned by OCR service
- Status codes are propagated

## Development

```bash
# Run Vercel dev server
vercel dev

# Test locally
curl -X POST http://localhost:3000/api/passport-ocr \
  -F "images=@/path/to/passport.jpg" \
  -F "default_checkout=2024-12-31"
```

## Deployment

The proxy is automatically deployed by Vercel when changes are pushed to the repository. Make sure to configure the environment variables in the Vercel dashboard.
