#!/usr/bin/env python3
# -*- coding: utf-8 -*-

file_path = 'src/components/dashboards/InsightGrid.tsx'

# Read the entire file content
with open(file_path, 'r', encoding='utf-8', errors='replace') as f:
    content = f.read()

# Replace the corrupted emoji characters directly in the string
# Projects icon: ðŸ" -> 📁
content = content.replace("'ðŸ\"", "'📁'")

# Novelty icon: ðŸ" -> 🔍
# But we need to be careful - replace only in the novelty section
# Let's find and replace more precisely

import re

# Replace projects icon
content = re.sub(
    r"(id: 'projects',.*?\n.*?icon: ')[^']*(')",
    r"\1📁\2",
    content,
    flags=re.DOTALL
)

# Replace novelty icon
content = re.sub(
    r"(id: 'novelty',.*?\n.*?icon: ')[^']*(')",
    r"\1🔍\2",
    content,
    flags=re.DOTALL
)

# Write back
with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed the remaining corrupted emoji characters")
