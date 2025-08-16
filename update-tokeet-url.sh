#!/bin/bash

# Script to update TOKEET_FEED_URL in environment files
# Usage: ./update-tokeet-url.sh "new_tokeet_feed_url"

if [ $# -eq 0 ]; then
    echo "Please provide the new Tokeet feed URL as an argument"
    echo "Usage: ./update-tokeet-url.sh \"https://datafeed.tokeet.com/v1/inquiry/...\""
    exit 1
fi

NEW_URL="$1"

echo "Updating Tokeet feed URL..."
echo "New URL: $NEW_URL"
echo ""

# Update .env.local
if [ -f .env.local ]; then
    echo "Updating .env.local..."
    # Create backup
    cp .env.local .env.local.backup
    # Update the URL
    sed -i '' "s|TOKEET_FEED_URL=.*|TOKEET_FEED_URL=\"$NEW_URL\"|" .env.local
    echo "✅ .env.local updated"
else
    echo "⚠️  .env.local not found"
fi

# Update .env.production
if [ -f .env.production ]; then
    echo "Updating .env.production..."
    # Create backup
    cp .env.production .env.production.backup
    # Update the URL
    sed -i '' "s|TOKEET_FEED_URL=.*|TOKEET_FEED_URL=\"$NEW_URL\"|" .env.production
    echo "✅ .env.production updated"
else
    echo "⚠️  .env.production not found"
fi

echo ""
echo "Environment files updated!"
echo "Backups created: .env.local.backup and .env.production.backup"
echo ""
echo "Next steps:"
echo "1. Test the new URL locally:"
echo "   node run-tokeet-upsert.js"
echo "2. Deploy to production if test is successful"
echo "3. Update Supabase Edge Function environment variable if needed"
