SELECT 'suggestions' as table_name, COUNT(*) as count FROM idea_bank_suggestions
UNION ALL
SELECT 'ideas' as table_name, COUNT(*) as count FROM idea_bank_ideas;