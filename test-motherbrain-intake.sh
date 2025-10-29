#!/bin/bash

# Test script for MotherBrain Guest Intake endpoint
# Usage: ./test-motherbrain-intake.sh [base_url]

BASE_URL=${1:-http://localhost:3000}
ENDPOINT="${BASE_URL}/motherbrain/guest-intake"

echo "Testing MotherBrain Guest Intake endpoint..."
echo "Endpoint: ${ENDPOINT}"
echo ""

# Example 1: Single passport with all optional fields
echo "=== Example 1: Single passport with metadata ==="
curl -X POST "${ENDPOINT}" \
  -F "images=@/path/to/passport1.jpg" \
  -F "_stay_id=A5_Crowley" \
  -F "_phone=+66981234567" \
  -F "_nickname=Tyler" \
  -F "_display_name=Tyler Crowley" \
  -F "_notes=First time in Thailand, traveling with family."

echo -e "\n\n"

# Example 2: Multiple passports (minimal metadata)
echo "=== Example 2: Multiple passports (minimal) ==="
curl -X POST "${ENDPOINT}" \
  -F "images=@/path/to/passport1.jpg" \
  -F "images=@/path/to/passport2.jpg" \
  -F "images=@/path/to/passport3.jpg" \
  -F "_stay_id=B7_Smith"

echo -e "\n\n"

# Example 3: Single passport without stay_id (for testing OCR only)
echo "=== Example 3: OCR only (no stay_id) ==="
curl -X POST "${ENDPOINT}" \
  -F "images=@/path/to/passport.jpg"

echo -e "\n\n"

# Example 4: Test error handling (no images)
echo "=== Example 4: Error case (no images) ==="
curl -X POST "${ENDPOINT}" \
  -F "_stay_id=A4_Test"

echo -e "\n\n"
