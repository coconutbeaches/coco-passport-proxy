# Passport OCR Service

FastAPI microservice for optical character recognition (OCR) of passport images. Uses PaddleOCR for text detection and recognition.

## Features

- Image preprocessing with OpenCV
- Tesseract OCR with PaddleOCR backend
- MRZ (Machine Readable Zone) parsing
- TSV output format compatible with existing guest database

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `OCR_SERVICE_TOKEN` | Bearer token for API authentication | Required |
| `PORT` | HTTP server port | `8080` |
| `ENV` | Environment (`local`, `dev`, `prod`) | `prod` |

## Development

```bash
# Install dependencies
pip install -r requirements.txt

# Run locally
uvicorn app:app --reload --port 8080

# Build container
docker build -t coco-passport-ocr .

# Run container
docker run -p 8080:8080 \
  -e OCR_SERVICE_TOKEN=dev \
  coco-passport-ocr
```

## API Routes

### POST /passport-ocr

Process passport images and return extracted data.

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- Body:
  - `images`: List of image files (required)
  - `default_checkout`: Default checkout date (optional)

**Response:**
```json
{
  "guests_tsv": "string",   // Tab-delimited guest records
  "guests": [{              // Array of raw OCR results
    "lines": [
      ["text", 0.98],      // [detected_text, confidence]
      ...
    ]
  }]
}
```

## Deployment

The service is automatically deployed to Google Cloud Run via GitHub Actions when changes are pushed to the `apps/ocr` directory.

Required secrets for deployment:
- `GCP_WIP`: Workload Identity Provider
- `GCP_SA_EMAIL`: Service account email
- `GCP_PROJECT`: Google Cloud project ID
- `GCP_REGION`: Deployment region
- `OCR_SERVICE_TOKEN`: API authentication token
