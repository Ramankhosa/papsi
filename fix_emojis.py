#!/usr/bin/env python3
# -*- coding: utf-8 -*-

file_path = 'src/components/dashboards/InsightGrid.tsx'

# Read file as binary to see exact bytes
with open(file_path, 'rb') as f:
    raw_content = f.read()

# The corrupted emojis are likely UTF-8 encoding issues
# Projects icon should be 📁 (U+1F4C1 = \xF0\x9F\x93\x81)
# Novelty icon should be 🔍 (U+1F50D = \xF0\x9F\x94\x8D)

# Try to find and replace corrupted sequences
# Common corruption: ðŸ" might be \xC3\xB0\xC5\xB8\xE2\x80\x9C or similar

# Read as text with error handling
try:
    content = raw_content.decode('utf-8')
except:
    content = raw_content.decode('utf-8', errors='replace')

# Direct string replacement - find the exact corrupted strings
# Projects: icon: 'ðŸ"'
if "icon: 'ðŸ\"" in content:
    # Find projects section
    import re
    # Match from id: 'projects' to the icon line
    pattern1 = r"(id: 'projects',\s+icon: ')[^']+(')"
    replacement1 = r"\1📁\2"
    content = re.sub(pattern1, replacement1, content, flags=re.DOTALL)

# Novelty: icon: 'ðŸ"'
if "icon: 'ðŸ\"" in content:
    pattern2 = r"(id: 'novelty',\s+icon: ')[^']+(')"
    replacement2 = r"\1🔍\2"
    content = re.sub(pattern2, replacement2, content, flags=re.DOTALL)

# More aggressive: replace any line containing the corrupted pattern after projects/novelty
lines = content.split('\n')
for i in range(len(lines)):
    if i > 0 and "id: 'projects'" in lines[i-1]:
        if 'icon:' in lines[i] and ('ð' in lines[i] or 'Ÿ' in lines[i]):
            lines[i] = re.sub(r"icon: '[^']+'", "icon: '📁'", lines[i])
    if i > 0 and "id: 'novelty'" in lines[i-1]:
        if 'icon:' in lines[i] and ('ð' in lines[i] or 'Ÿ' in lines[i]):
            lines[i] = re.sub(r"icon: '[^']+'", "icon: '🔍'", lines[i])

content = '\n'.join(lines)

# Write back
with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed emoji characters")
