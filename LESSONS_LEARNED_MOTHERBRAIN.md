# Lessons Learned: MotherBrain OCR Integration Mistakes & Solutions

## Overview
This document catalogs the mistakes made during the initial implementation of the MotherBrain OCR guest intake integration and the solutions that resolved them.

---

## ❌ MISTAKE #1: Wrong Authentication Token Type

### What Went Wrong
Used a Supabase `service_role` JWT token as the `MOTHERBRAIN_API_KEY` instead of the correct `BRIDGE_TOKEN` for MotherBrain MCP authentication.

### The Error
```json
{"error": "MotherBrainGPT API returned 401: Unauthorized"}
```

### Why It Failed
- MotherBrain MCP server expects a simple bearer token (`BRIDGE_TOKEN`)
- Supabase JWT tokens are for Supabase's own API, not third-party services
- Different authentication systems require different token types

### The Solution
```bash
# Generate proper bridge token
TOKEN=$(openssl rand -hex 32)

# Sync across both services
fly secrets set BRIDGE_TOKEN=$TOKEN --app supabase-mcp-fly
vercel env add MOTHERBRAIN_API_KEY production <<< $TOKEN
```

### Key Lesson
**Always verify what authentication method an API expects before assuming JWT/Bearer token format.**

---

## ❌ MISTAKE #2: Wrong API Endpoint (Non-existent Tool)

### What Went Wrong
Attempted to call `/api/tools/upsert_guest_from_checkin` which doesn't exist in the MotherBrain MCP server.

### The Assumption
Assumed a high-level guest upsert tool existed without checking available tools.

### Why It Failed
The MotherBrain MCP server only has 20 tools, none of which are guest-specific:
```
search_docs, list_tables, list_extensions, list_migrations,
apply_migration, execute_sql, get_logs, get_advisors,
get_project_url, get_anon_key, generate_typescript_types,
list_edge_functions, get_edge_function, deploy_edge_function,
create_branch, list_branches, delete_branch, merge_branch,
reset_branch, rebase_branch
```

### The Solution
```bash
# Always discover available tools first
curl -X GET https://supabase-mcp-fly.fly.dev/api/tools \
  -H "Authorization: Bearer $TOKEN"
```

Then use `execute_sql` to run custom queries.

### Key Lesson
**Always call the tool discovery endpoint (`GET /api/tools`) before assuming specific tools exist. Don't hardcode endpoint names without verification.**

---

## ❌ MISTAKE #3: Wrong Payload Format

### What Went Wrong
Sent `{guests: [{...}]}` payload format instead of `{arguments: {query: "SQL..."}}` for the execute_sql tool.

### The Code
```javascript
// WRONG ❌
const payload = { guests: [...] };

// CORRECT ✅
const payload = {
  arguments: {
    query: "INSERT INTO..."
  }
};
```

### Why It Failed
Each MCP tool has its own expected payload structure. The `execute_sql` tool specifically requires an `arguments` object with a `query` field.

### Key Lesson
**Read the tool's schema/documentation to understand the exact payload structure. MCP tools use standardized `{arguments: {...}}` format.**

---

## ❌ MISTAKE #4: Debug Logging Bug

### What Went Wrong
```javascript
console.log('[MotherBrain Debug] Payload guest count:', motherbrainPayload.guests.length);
```

Tried to access `.guests.length` after changing payload structure to `{arguments: {query: sql}}`.

### The Error
```
Cannot read properties of undefined (reading 'length')
```

### Why It Failed
After refactoring the payload to use SQL format, the `guests` property no longer existed, but debug logging wasn't updated.

### The Solution
```javascript
// Use the actual source data
console.log('[MotherBrain Debug] Guest count:', guests.length);
```

### Key Lesson
**When refactoring data structures, search for ALL references to the old structure, including debug/logging code. Use IDE's "Find All References" feature.**

---

## ❌ MISTAKE #5: VIZ Parser Couldn't Handle US Passport Format

### What Went Wrong
The OCR parser only extracted "S" and "Crowley" instead of full passport data.

### The Problem
US passports use slash-separated multilingual format:
```
Surname/Nom/Apellidos
CROWLEY

Given names/Prénoms/Nombres
TYLER
```

Original regex only matched colon/space format:
```javascript
// Only worked for: "SURNAME: CROWLEY"
/SURNAME[:\s]*([A-Z \-']+)/
```

### Why It Failed
- Regex didn't account for newline between label and value
- Didn't handle slash-separated multilingual headers
- US date format (03 SEP 1974) wasn't recognized
- Passport number pattern was too restrictive

### The Solution
```javascript
// Enhanced to handle US format
const last = pull(
  /SURNAME\/[^\n]*\n\s*([A-Z][A-Z \-']+)/,  // US: label\n value
  /SURNAME[:\s]+([A-Z][A-Z \-']+)/,          // Standard: label: value
  // ... more patterns
);

// Add US date parser
const parseDate = (dateStr) => {
  // Handle: 03 SEP 1974
  const usMatch = dateStr.match(/(\d{1,2})\s+([A-Z]{3})\s+(\d{4})/);
  if (usMatch) {
    const months = {JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12};
    // ... convert to YYYY-MM-DD
  }
};
```

### Key Lesson
**When parsing international documents, test with actual samples from different countries. US, European, and Asian passports have different formats. Build flexible regex patterns that handle multiple formats.**

---

## ❌ MISTAKE #6: Passport Number Regex Too Greedy

### What Went Wrong
Passport number field captured "USA" instead of "A04734799".

### The Problem
```javascript
// Too permissive - matched any 3+ characters
/PASSPORT\s+NO\.?[:\s]*([A-Z0-9]+)/
```

This matched "USA" before finding the actual passport number.

### The Solution
```javascript
// Require 6-12 characters to avoid matching country codes
/PASSPORT\s+NO\.?\/[^\n]*\n\s*([A-Z0-9]{6,12})/,  // US format
/(?:DOCUMENT|PASSPORT)\s*NO\.?[:\s]*([A-Z0-9]{6,12})/, 
/\b([A-Z]\d{8,9})\b/  // Common format: letter + 8-9 digits
```

### Key Lesson
**Add length constraints to regex patterns to avoid false matches. Passport numbers are typically 6-12 characters, not 3.**

---

## ❌ MISTAKE #7: SQL ON CONFLICT Without Matching Constraint

### What Went Wrong
```sql
INSERT INTO incoming_guests (...)
VALUES (...)
ON CONFLICT (stay_id, first_name)
DO UPDATE SET ...
```

### The Error
```
ERROR: 42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification
```

### Why It Failed
The `incoming_guests` table didn't have a unique constraint on `(stay_id, first_name)`.

### The Solution
Remove the UPSERT logic and use simple INSERT:
```sql
INSERT INTO incoming_guests (...)
VALUES (...)
RETURNING id, stay_id, first_name, last_name;
```

If UPSERT is needed, add the constraint first:
```sql
ALTER TABLE incoming_guests 
ADD CONSTRAINT incoming_guests_stay_first_key 
UNIQUE (stay_id, first_name);
```

### Key Lesson
**Always verify database constraints before using ON CONFLICT. Check `\d table_name` in psql or query `information_schema.table_constraints`.**

---

## ❌ MISTAKE #8: Using Read-Only Database User

### What Went Wrong
MotherBrain MCP server connected as `supabase_read_only_user`, causing silent failures where SQL executed successfully but didn't persist data.

### The Error Pattern
```json
{
  "success": true,
  "message": "Tool 'execute_sql' executed successfully"
}
```

But `SELECT COUNT(*) ... = 0` - no data persisted.

### Discovery
```sql
SELECT current_user, session_user;
-- Returns: {"current_user":"supabase_read_only_user"}
```

### Why It Failed
- Read-only users can execute queries but changes are rolled back
- No explicit error because the SQL syntax was valid
- The MCP server was configured to use read-only access for safety

### The Wrong Fix
Tried to grant write permissions:
```sql
GRANT INSERT, SELECT, UPDATE ON incoming_guests TO service_role;
```

This didn't work because the MCP server still used `supabase_read_only_user`.

### The Correct Solution
**Bypass the read-only MCP entirely** - use direct Supabase REST API:

```javascript
// ❌ WRONG: Use read-only MCP
const response = await fetch('https://supabase-mcp-fly.fly.dev/api/tools/execute_sql', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${MOTHERBRAIN_API_KEY}` },
  body: JSON.stringify({ arguments: { query: sql } })
});

// ✅ CORRECT: Direct Supabase REST API with service_role
const response = await fetch(`${SUPABASE_URL}/rest/v1/incoming_guests`, {
  method: 'POST',
  headers: {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  },
  body: JSON.stringify(guestRecords)
});
```

### Key Lesson
**When database writes mysteriously don't persist:**
1. Check `SELECT current_user;` to verify what role is being used
2. Verify the user has INSERT/UPDATE permissions
3. Check if the connection is in read-only mode
4. Consider bypassing intermediary layers (like MCP) for write operations
5. Use direct database APIs with write-capable credentials

**Architecture principle: Read-only proxies are great for queries, but for writes, go direct to the source with proper credentials.**

---

## 🎯 Summary of Key Takeaways

### 1. API Integration Checklist
- [ ] Discover available endpoints/tools first (`GET /api/tools`)
- [ ] Verify authentication method (JWT vs Bearer vs API Key)
- [ ] Test authentication before building full integration
- [ ] Read payload format from documentation, don't assume
- [ ] Test with real data samples, not just synthetic data

### 2. OCR & Document Parsing
- [ ] Test with documents from multiple countries
- [ ] Handle multiple date formats (US: "03 SEP 1974", EU: "03/09/1974")
- [ ] Build flexible regex with multiple fallback patterns
- [ ] Add length constraints to prevent false matches
- [ ] Parse both VIZ (visual) and MRZ (machine readable zone)

### 3. Database Operations
- [ ] Verify constraints exist before using ON CONFLICT
- [ ] Check `current_user` to ensure write permissions
- [ ] Test that data actually persists (SELECT after INSERT)
- [ ] For critical writes, use direct API with write credentials
- [ ] Don't rely on intermediary services for write operations

### 4. Debugging Best Practices
- [ ] Use structured logging with context
- [ ] Log only first N characters of secrets (e.g., `token.slice(0, 10)`)
- [ ] Update all references when refactoring data structures
- [ ] Test error paths, not just happy paths
- [ ] Verify assumptions with diagnostic queries

### 5. Code Maintenance
- [ ] Search entire codebase when renaming variables/properties
- [ ] Keep debug logging in sync with code changes
- [ ] Document why specific patterns/workarounds exist
- [ ] Add inline comments for non-obvious regex patterns

---

## 📚 Files to Reference

- `MOTHERBRAIN_DEBUG_RESOLUTION.md` - Full debug session notes
- `MOTHERBRAIN_INTEGRATION.md` - Integration documentation
- `motherbrain-ocr.js` - Final working implementation
- This file - Lessons learned for future implementations

---

## 🔄 If You Were to Rebuild This From Scratch

### The Right Sequence

1. **Discovery Phase** (30 min)
   ```bash
   # Discover available tools
   curl GET https://api-endpoint/api/tools
   
   # Test authentication
   curl -H "Authorization: Bearer test" GET https://api-endpoint/health
   
   # Check database user
   SELECT current_user, current_schema();
   ```

2. **Choose Architecture** (15 min)
   - If API has write tools → Use API
   - If API is read-only → Use direct database
   - Document the decision

3. **Build Minimal Proof of Concept** (1 hour)
   - Single passport, single field extraction
   - One database insert
   - Verify data persists

4. **Expand Incrementally** (2-3 hours)
   - Add all OCR fields
   - Test with real passports from different countries
   - Add error handling
   - Add metadata fields

5. **Production Hardening** (1 hour)
   - Security audit (no secret leaks)
   - Error messages user-friendly
   - Logging for debugging
   - Documentation

**Total: ~5-6 hours instead of the 8+ hours spent debugging**

---

*Document created: 2025-10-29*  
*Project: coco-passport-proxy MotherBrain Integration*  
*For: Future AI assistants and developers*
