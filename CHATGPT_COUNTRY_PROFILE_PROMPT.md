# Country Profile Creation Guide for Patent Drafting System

## 🎯 **OBJECTIVE**
Create a new country profile JSON file that is fully compatible with our patent drafting system. The profile must follow the exact schema and structure validated across US, PCT, AU, and CA profiles.

## 📋 **REQUIRED OUTPUT FORMAT**
Use the attached `country-profile-template.json` as your starting point. **DO NOT modify the JSON structure or field names.** Only customize the values according to the target country's patent laws and practices.

---

## 🔧 **STEP-BY-STEP CREATION INSTRUCTIONS**

### **1. META SECTION**
```json
{
  "meta": {
    "id": "XX",                    // 2-letter country code (e.g., "EP", "IN", "JP")
    "code": "XX",                  // Same as id
    "name": "Full Country Name",   // Official country name
    "continent": "Continent",      // Continent name
    "office": "Patent Office Name", // Full official name
    "officeUrl": "https://...",    // Official website
    "applicationTypes": ["standard"], // Usually ["standard"] or ["utility"]
    "languages": ["en"],           // ISO language codes
    "version": 1,                  // Start with 1
    "status": "active",           // Always "active"
    "inheritsFrom": null,         // Always null
    "tags": ["tag1", "tag2"],     // Relevant tags (e.g., ["anglophone", "national_phase"])
    "createdAt": "2025-01-01T00:00:00Z",
    "updatedAt": "2025-01-01T00:00:00Z"
  }
}
```

### **2. STRUCTURE SECTION**
**CRITICAL**: The section IDs must exactly match the prompt section keys. The system expects these exact IDs:

**Required Section IDs:**
- `title` - Title section
- `cross_reference` - Cross-references
- `field` - Technical field
- `background` - Background art
- `summary` - Summary of invention
- `brief_drawings` - Brief description of drawings
- `detailed_description` - Detailed description
- `claims` - Claims
- `abstract` - Abstract

**Variant ID**: Must be `"standard"` (not the country code).

### **3. RULES SECTION**
Customize based on the country's patent laws:

**Required Rule Blocks:**
- `global` - General formatting rules
- `abstract` - Abstract requirements
- `claims` - Claim drafting rules
- `description` - Description requirements
- `drawings` - Drawing specifications
- `procedural` - Filing procedures
- `language` - Language requirements
- `sequenceListing` - Biotech sequence rules
- `pageLayout` - Page formatting

**For PCT applications, add:**
```json
"designatedStates": {
  "mode": "all_by_default",
  "totalStates": 157,
  "electionAllowed": true,
  "electionRequiredForChapterII": false,
  "chapterIIDeadlineMonths": 22,
  "notes": "PCT designated states information"
}
```

### **4. VALIDATION SECTION**
**CRITICAL**: The `sectionChecks` keys must match the actual section IDs from structure:
- ✅ `"title": [...]`
- ✅ `"abstract": [...]`
- ✅ `"claims": [...]`
- ❌ NOT: `"title_length": [...]`

### **5. PROMPTS SECTION**
**CRITICAL**: The `sections` keys must exactly match the section IDs from structure:
- ✅ `"title": {...}`
- ✅ `"field": {...}`
- ✅ `"background": {...}`
- ✅ `"summary": {...}`
- ✅ `"detailed_description": {...}`
- ✅ `"claims": {...}`
- ✅ `"abstract": {...}`

### **6. EXPORT SECTION**
Customize document types and formatting. Ensure `marginTopCm`, `marginBottomCm`, `marginLeftCm`, `marginRightCm` are included.

### **7. CROSSCHECKS SECTION**
**CRITICAL**: References must point to actual section IDs:
- `"brief_drawings"` (not `"drawings"`)
- `"detailed_description"` (not `"description"`)

---

## ⚠️ **COMMON MISTAKES TO AVOID**

### **❌ WRONG: Mismatched Section References**
```json
// Structure has "field" but prompts reference "technical_field"
"structure": { "sections": [{ "id": "field", ... }] },
"prompts": { "sections": { "technical_field": {...} } } // ❌ WRONG
```

### **❌ WRONG: Invalid Validation Keys**
```json
"validation": {
  "sectionChecks": {
    "title_validation": [...] // ❌ WRONG - should be "title"
  }
}
```

### **❌ WRONG: Drawing References**
```json
"crossChecks": {
  "checkList": [{
    "from": "drawings", // ❌ WRONG - should be "brief_drawings"
    "mustBeShownIn": ["drawings"] // ❌ WRONG
  }]
}
```

### **❌ WRONG: Missing Margins**
```json
"export": {
  "documentTypes": [{
    // ❌ MISSING: marginTopCm, marginBottomCm, marginLeftCm, marginRightCm
  }]
}
```

---

## ✅ **VALIDATION CHECKLIST**

Before submitting, verify:

1. **✅ Section IDs Match**: Structure section IDs exactly match prompt section keys
2. **✅ Validation Keys Match**: sectionChecks keys match actual section IDs
3. **✅ CrossCheck References**: All "from", "mustBeExplainedIn", "mustBeShownIn" point to real section IDs
4. **✅ Drawing References**: Use "brief_drawings" (not "drawings")
5. **✅ Margins Present**: All documentTypes have marginTopCm, marginBottomCm, marginLeftCm, marginRightCm
6. **✅ Required Fields**: All top-level keys present: meta, structure, rules, validation, prompts, export, diagrams, crossChecks
7. **✅ JSON Valid**: Proper JSON syntax, no trailing commas

---

## 🚀 **FINAL OUTPUT**

Provide a complete JSON file following the template structure. The JSON must be:
- **Syntactically valid**
- **Schema compliant**
- **Reference consistent**
- **Production ready**

**Example filename**: `Countries/XX.json` (where XX is the country code)

---

## 📞 **SUPPORT**

If validation fails, common issues are:
1. Prompt section keys don't match structure section IDs
2. CrossCheck references point to non-existent sections
3. Missing margin fields in export section
4. Validation sectionChecks keys don't match actual sections

**All existing profiles (US, PCT, AU, CA) follow this exact structure and pass validation.**
