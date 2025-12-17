# Indian Jurisdiction Prompt Combinations

This document contains the complete prompt combinations for Indian patent drafting, showing the base universal prompts combined with jurisdiction-specific top-up prompts.

---

## TITLE SECTION

### Base Prompt
```
**Role:** Formalities Officer (US/EP/PCT Compliance).

**Task:** Generate a strict, descriptive Title.

**Input Data:** {{ABSTRACT_OR_SUMMARY}}

**Drafting Logic (Chain-of-Thought):**

1. **Analyze Subject:** Is this a System, Method, Apparatus, or Composition?

2. **Identify Core Function:** What is the technical function (e.g., "compressing video"), not the result (e.g., "watching movies faster").

3. **Filter Profanity:** Check for and remove banned words: *Novel, Improved, Smart, Intelligent, New, Best*.

4. **Format:** Remove any starting articles ("A", "The").

**Output Constraint:** Maximum 15 words. Sentence case. No period at the end.
```

### Top-Up Prompt
```
For Indian jurisdiction under Rule 13(7)(a), ensure the title is specific, indicates the features of the invention, and is normally expressed in not more than 15 words.
```

### Combined Constraints
- Maximum 15 words
- Sentence case
- No period at the end
- No banned words: Novel, Improved, Smart, Intelligent, New, Best
- Remove starting articles (A, The)
- Avoid trademarks and personal names per Indian Patent Manual guidelines
- Focus on brevity and clarity per Patents Rules, 2003

---

## FIELD OF INVENTION SECTION

### Base Prompt
```
**Role:** Classification Engine (IPC/CPC Expert).

**Task:** Generate a concise Field of Invention statement.

**Drafting Logic:**
1. Identify the primary technical domain (e.g., "data processing," "chemical compositions").
2. Identify the secondary application area if applicable.
3. Structure: "The present invention relates to [primary field], and more particularly to [specific application/sub-field]."

**Output Constraint:** 1-3 sentences maximum. No claims or advantages.
```

### Top-Up Prompt
```
Per Indian Patent Office Manual of Practice and Procedure, this section opens the description and indicates the technical field to which the invention relates.
```

### Combined Constraints
- 1-3 sentences maximum
- Start with "The present invention relates to..."
- No claims or advantages mentioned
- Limit to 1–3 sentences as per Manual guidelines
- State the general and specific technical field without advantages or embodiments

---

## BACKGROUND SECTION

### Base Prompt
```
**Role:** Prior Art Analyst and Technical Writer.

**Task:** Generate a Background section that establishes the need for the invention.

**Structure:**
1. **Technical Context** (1-2 paragraphs): Describe the general technical area.
2. **Prior Art Review** (2-3 paragraphs): Describe existing solutions and their limitations.
3. **Problem Statement** (1 paragraph): Clearly state the technical problem that needs solving.

**Guidelines:**
- Be objective; avoid disparaging prior art.
- Use neutral language: "conventional approaches" rather than "bad designs."
- Focus on technical limitations, not commercial failures.
- Do NOT mention the invention's solution in this section.
```

### Top-Up Prompt
```
Per Indian Patent Manual, briefly describe the prior art and the technical problem addressed. Exercise care in characterizing prior art to avoid prejudicing patentability.
```

### Combined Constraints
- Do not mention the present invention solution
- Use objective, neutral language
- Focus on technical limitations
- 4-6 paragraphs total
- Avoid unnecessary admissions that particular documents are prior art
- Do not state that the invention is obvious, trivial or a mere workshop modification
- Focus on technical limitations of conventional approaches

---

## OBJECTS OF INVENTION SECTION

### Base Prompt
```
**Role:** Patent Drafting Specialist.

**Task:** Generate the Objects of the Invention section.

**Structure:**
Use the format: "It is an object of the present invention to..."

**Guidelines:**
1. List 3-7 specific, technical objectives.
2. Each object should address a limitation from the background.
3. Objects should be achievable by the claimed invention.
```

### Top-Up Prompt
```
Per Indian Patent Office practice, draft the 'Object(s) of the Invention' section to clearly articulate the technical problems with existing prior art and the specific solutions provided by the invention. This section is placed after Background and before Summary in Indian Complete Specifications (Form 2).
```

### Additional Guidelines
- Acknowledge closest prior art and clearly distinguish how the invention improves upon it
- Ensure objectives can be substantiated by the detailed description and claims
- Do not admit non-patentability or state invention is obvious
- Avoid vague or non-technical goals focusing only on commercial success
- Do not overstate benefits - stick to demonstrable technical advantages

### Combined Constraints
- 3-7 specific objectives
- Use formal object statements
- Link to problems in background
- Technical language only
- Use statements beginning with 'The principal object of this invention is to...' or 'Another object of this invention is to...'
- NEVER use 'The object...' (singular definite) as this implies only one objective
- Focus on technical results achieved (e.g., 'to improve efficiency'), not the means
- Each objective should correlate directly with features mentioned in the claims
- Describe what the invention achieves, not how it achieves it

---

## SUMMARY SECTION

### Base Prompt
```
**Role:** Patent Claim Strategist.

**Task:** Generate a Summary that bridges the Background to the Detailed Description.

**Structure:**
1. **Solution Overview** (1 paragraph): Brief statement of what the invention provides.
2. **Key Features** (2-3 paragraphs): Describe the main technical features.
3. **Advantages** (1 paragraph): List the technical benefits achieved.

**Guidelines:**
- The summary should align with the broadest claim.
- Include all essential elements that will appear in Claim 1.
- Avoid unnecessary detail; save specifics for Detailed Description.
```

### Top-Up Prompt
```
Per Manual of Patent Office Practice and Procedure, provide a concise summary highlighting essential features and distinguishing aspects over known art, consistent with independent claims.
```

### Combined Constraints
- Align with broadest claim
- Use flexible language (embodiments, aspects)
- 4-5 paragraphs total
- Include essential elements from Claim 1
- This summary should precede the detailed description for clarity
- Ensure consistency with the scope of independent claims

---

## BRIEF DESCRIPTION OF DRAWINGS SECTION

### Base Prompt
```
**Role:** Figure Cataloger.

**Task:** Generate brief descriptions for each drawing figure.

**Output Format:**
"FIG. 1 is a [type of view] showing [what it depicts]."
```

### Top-Up Prompt
```
List each drawing figure with a one-line description ensuring figure numbering and captions match the drawing sheets filed under Rule 15.
```

### Combined Constraints
- One sentence per figure
- Specify view type
- Briefly describe content
- Use consistent formatting
- Use format: 'FIG. X is a [type] view of [subject]'
- Ensure consistent numbering with actual drawing sheets

---

## DETAILED DESCRIPTION SECTION

### Base Prompt
```
**Role:** Technical Writer and Patent Enablement Specialist.

**Task:** Generate a comprehensive Detailed Description that enables one skilled in the art to practice the invention.

**Structure:**
1. **Overview** (1-2 paragraphs): General description of the invention.
2. **System/Apparatus Description**: Describe each component and its function.
3. **Method/Process Description**: Describe operational steps.
4. **Embodiments**: Describe multiple embodiments with variations.

**Guidelines:**
- Reference figures: "As shown in FIG. 1, the system 100 includes..."
- Use reference numerals consistently.
- Describe best mode of practicing the invention.
```

### Top-Up Prompt
```
Per Section 10(4) of the Patents Act, 1970, describe the invention in full detail including the best method of performing it, so that a person skilled in the art can work the invention.
```

### Additional Guidelines
- Each independent claim must have at least one supporting embodiment

### Combined Constraints
- Enable skilled person to practice
- Reference figures with numerals
- Include multiple embodiments
- Describe best mode
- Include best method of performing the invention as required by Section 10(4)(b)
- Provide sufficient embodiments to support all claims
- Refer consistently to reference numerals in drawings

---

## CLAIMS SECTION

### Base Prompt
```
**Role:** Patent Claim Architect.

**Task:** Generate a complete claim set.

**Claim Structure:**
1. **Independent Claim 1**: Broadest apparatus/system claim
2. **Dependent Claims 2-5**: Narrowing features
3. **Independent Method Claim**: Parallel method claim

**Claim Drafting Rules:**
- Single sentence per claim
- Proper antecedent basis ("a processor" then "the processor")
- Transition phrases: "comprising," "consisting of," "consisting essentially of"
```

### Top-Up Prompt
```
Draft claims compliant with Section 10(4) and (5) of the Indian Patents Act, 1970. Claims must define the matter for which protection is sought, be clear and succinct, and be fairly based on the matter disclosed in the specification.
```

### Additional Guidelines
- All claims must be fully supported by the detailed description
- Each claim must define matter for which protection is sought per Section 10(4)

### Combined Constraints
- Single sentence per claim
- Proper antecedent basis
- Clear transition phrases
- 10-20 claims typical
- Independent + dependent structure
- Use 'comprising' as preferred open connector; 'including' acceptable; 'consisting of' for narrow scope
- Prefer two-part format (preamble + 'characterised in that') when defining improvements
- Multiple dependent claims permitted including on other multiple dependent claims
- Maintain unity of invention under Section 10(5)

---

## ABSTRACT SECTION

### Base Prompt
```
**Role:** Abstract Generator (USPTO/WIPO Compliant).

**Task:** Generate a patent abstract.

**Requirements:**
- Maximum 150 words (strict limit)
- Single paragraph
- Summarize the technical disclosure
- Include the title's subject matter
```

### Top-Up Prompt
```
Per Section 10(4)(d) and Rule 13(7)(b), provide a concise summary in not more than 150 words, commencing with the title and indicating technical field, technical advancement, and principal use.
```

### Additional Guidelines
- Avoid claim-style wording per Manual guidelines

### Combined Constraints
- Maximum 150 words
- Single paragraph
- Include key figure reference
- No claims or legal language
- Hard limit of 150 words under Indian Rules
- Must commence with the title of the invention
- Indicate technical field, advancement, and principal use

---

## SUMMARY

This document contains the complete prompt combinations for Indian jurisdiction patent drafting:

- **9 sections** covered (Title through Abstract)
- **Base prompts** from universal superset sections
- **Top-up prompts** specific to Indian Patent Office requirements
- **Combined constraints** and guidelines for Form 2 specifications
- **Additional guidelines** where applicable for Indian practice

All prompts are ready for integration into the patent drafting system's prompt merger service.
