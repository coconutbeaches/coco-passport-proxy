# Documentation Index

## 🚀 Start Here

**New to this project?** Start with **COCOGPT_PASSPORT_WORKFLOW.md**

**Need quick reference?** Use **QUICKSTART_PASSPORT.md**

**Building integrations?** See **PASSPORT_API_SUMMARY.md**

---

## 📚 Documentation Files

### 1. COCOGPT_PASSPORT_WORKFLOW.md ⭐ START HERE
**For:** Users, CocoGPT operators  
**Purpose:** Understand the simple workflow  
**Contains:**
- What you provide (passport photos + stay_id)
- What CocoGPT does automatically
- Expected results
- Example conversations
- Character normalization examples

**Read this if:** You want to understand how to use the system

---

### 2. QUICKSTART_PASSPORT.md ⚡ QUICK REFERENCE
**For:** Developers, API users  
**Purpose:** Fast reference for API calls  
**Contains:**
- Minimal example (copy-paste ready)
- Full example with all fields
- Character normalization table
- cURL examples

**Read this if:** You need to make API calls quickly

---

### 3. PASSPORT_API_SUMMARY.md 📖 COMPLETE API DOCS
**For:** Developers, integrators  
**Purpose:** Complete API documentation  
**Contains:**
- Full API specification
- Request/response formats
- Field mappings and types
- Error handling
- Code examples (JavaScript, cURL)
- Database schema details

**Read this if:** You're building an integration or need detailed API info

---

### 4. PASSPORT_ENTRY_GUIDE.md 🔧 TECHNICAL GUIDE
**For:** Database administrators, troubleshooters  
**Purpose:** Technical implementation details  
**Contains:**
- Database insert strategies
- Constraint management
- Trigger handling
- Troubleshooting procedures
- SQL examples
- Critical rules

**Read this if:** You need to troubleshoot or understand database operations

---

### 5. ARCHITECTURE.md 🏗️ SYSTEM ARCHITECTURE
**For:** System architects, developers  
**Purpose:** Understand system design  
**Contains:**
- Workflow diagrams
- Data flow visualization
- Technology stack
- Security architecture
- Performance considerations
- Error handling strategies

**Read this if:** You need to understand how the system works internally

---

### 6. IMPLEMENTATION_COMPLETE.md ✅ SUMMARY
**For:** Project managers, stakeholders  
**Purpose:** Implementation summary  
**Contains:**
- What was implemented
- Files created/modified
- Success criteria checklist
- Testing instructions
- Next steps

**Read this if:** You need an overview of what was delivered

---

### 7. README.md 📄 PROJECT OVERVIEW
**For:** Everyone  
**Purpose:** Project introduction  
**Contains:**
- Feature overview
- API endpoints list
- Environment setup
- Tokeet integration
- Database schema

**Read this if:** You need general project information

---

## 🎯 Quick Navigation by Task

### I want to...

#### **Upload passports via CocoGPT**
→ Read: **COCOGPT_PASSPORT_WORKFLOW.md**

#### **Make API calls to add guests**
→ Read: **QUICKSTART_PASSPORT.md**  
→ Then: **PASSPORT_API_SUMMARY.md**

#### **Troubleshoot database errors**
→ Read: **PASSPORT_ENTRY_GUIDE.md** (Troubleshooting section)

#### **Understand character normalization**
→ Read: **COCOGPT_PASSPORT_WORKFLOW.md** (Character Normalization section)  
→ Or: **QUICKSTART_PASSPORT.md** (table format)

#### **Build an integration**
→ Read: **PASSPORT_API_SUMMARY.md**  
→ Check: **examples/add-passport-guests-example.js**

#### **Understand the system architecture**
→ Read: **ARCHITECTURE.md**

#### **See what was implemented**
→ Read: **IMPLEMENTATION_COMPLETE.md**

---

## 📁 File Organization

```
coco-passport-proxy/
│
├── 📄 README.md                          # Project overview
├── 📄 DOCS_INDEX.md                      # This file
│
├── 🚀 COCOGPT_PASSPORT_WORKFLOW.md       # User workflow (START HERE)
├── ⚡ QUICKSTART_PASSPORT.md             # Quick reference
├── 📖 PASSPORT_API_SUMMARY.md            # Complete API docs
├── 🔧 PASSPORT_ENTRY_GUIDE.md            # Technical guide
├── 🏗️ ARCHITECTURE.md                    # System architecture
├── ✅ IMPLEMENTATION_COMPLETE.md         # Implementation summary
│
├── examples/
│   └── add-passport-guests-example.js    # Code examples
│
└── index.js                              # Main API code
```

---

## 🎓 Learning Path

### Path 1: User (Non-technical)
1. COCOGPT_PASSPORT_WORKFLOW.md
2. Done! You're ready to use the system.

### Path 2: Developer (Quick Start)
1. QUICKSTART_PASSPORT.md
2. examples/add-passport-guests-example.js
3. PASSPORT_API_SUMMARY.md (as needed)

### Path 3: Developer (Complete)
1. README.md (overview)
2. COCOGPT_PASSPORT_WORKFLOW.md (understand workflow)
3. PASSPORT_API_SUMMARY.md (API details)
4. examples/add-passport-guests-example.js (code examples)
5. ARCHITECTURE.md (system design)

### Path 4: Database Administrator
1. PASSPORT_ENTRY_GUIDE.md
2. ARCHITECTURE.md (Database Constraints section)
3. PASSPORT_API_SUMMARY.md (Database Schema section)

### Path 5: Troubleshooter
1. PASSPORT_ENTRY_GUIDE.md (Troubleshooting section)
2. ARCHITECTURE.md (Error Handling section)
3. index.js (read the actual code)

---

## 📊 Document Size Reference

| File | Lines | Purpose |
|------|-------|---------|
| COCOGPT_PASSPORT_WORKFLOW.md | 242 | User workflow guide |
| PASSPORT_ENTRY_GUIDE.md | 146 | Technical implementation |
| PASSPORT_API_SUMMARY.md | 327 | API documentation |
| QUICKSTART_PASSPORT.md | 113 | Quick reference |
| ARCHITECTURE.md | 345 | System architecture |
| IMPLEMENTATION_COMPLETE.md | 356 | Implementation summary |
| examples/*.js | 154 | Code examples |
| **TOTAL** | **1,683** | Complete documentation |

---

## 🔍 Search Guide

**Looking for:**

- **Character normalization rules** → COCOGPT_PASSPORT_WORKFLOW.md or QUICKSTART_PASSPORT.md
- **API request format** → QUICKSTART_PASSPORT.md or PASSPORT_API_SUMMARY.md
- **Error messages** → PASSPORT_API_SUMMARY.md (Error Handling section)
- **Database constraints** → PASSPORT_ENTRY_GUIDE.md or ARCHITECTURE.md
- **Trigger management** → PASSPORT_ENTRY_GUIDE.md
- **cURL examples** → QUICKSTART_PASSPORT.md or PASSPORT_API_SUMMARY.md
- **JavaScript examples** → examples/add-passport-guests-example.js
- **Troubleshooting steps** → PASSPORT_ENTRY_GUIDE.md (Troubleshooting section)
- **System diagrams** → ARCHITECTURE.md
- **What was implemented** → IMPLEMENTATION_COMPLETE.md

---

## 🆘 Getting Help

**Can't find what you need?**

1. Use the "I want to..." quick navigation above
2. Check the Search Guide
3. Follow the appropriate Learning Path
4. Read the relevant document section

**Still stuck?**

- Check examples/add-passport-guests-example.js for working code
- Review PASSPORT_ENTRY_GUIDE.md troubleshooting section
- Examine the actual API code in index.js

---

## 📝 Quick Reference

### Key Concepts

- **stay_id** - Booking identifier (e.g., "A6_CHRISTEN")
- **guest row** - Database row with row_type='guest'
- **booking row** - Database row with row_type='booking'
- **Character normalization** - Converting ø→o, ü→u, etc.

### Key Rules

- Always create NEW guest rows
- Never update booking rows
- Set booking_id=NULL always
- Set phone_e164=NULL always
- Use source='tokeet_import'
- Normalize international characters

### Key Files

- **index.js** - Main API code
- **COCOGPT_PASSPORT_WORKFLOW.md** - User guide
- **QUICKSTART_PASSPORT.md** - Quick reference

---

**Last Updated:** February 14, 2026  
**Documentation Version:** 1.0  
**API Endpoint:** https://coco-passport-proxy.vercel.app/add-passport-guests
