"""Dependency-free, inspectable retrieval for small local Markdown collections.

Chinese bigrams plus Latin identifier terms avoid relying on whitespace tokenization.
This is lexical retrieval, not embedding search; snippets keep their original text.
"""
import math
import re
from collections import Counter


def terms(text):
    latin = re.findall(r'[a-zA-Z_][a-zA-Z_0-9.-]{1,}', text.lower())
    chinese = re.findall(r'[\u4e00-\u9fff]+', text)
    return latin + [s[i:i+2] for s in chinese for i in range(len(s)-1)]


def retrieve(documents, query, limit=8):
    tokens = set(terms(query))
    candidates = []
    for doc in documents:
        content = doc['content']
        title_tokens = set(terms(doc['title']))
        for start in range(0, len(content), 1050):
            chunk = content[start:start+1250]
            counts = Counter(terms(chunk))
            score = sum(1 + math.log1p(counts[t]) for t in tokens if t in counts) + 2 * len(tokens & title_tokens)
            candidates.append((score, start, doc, chunk))
    candidates.sort(key=lambda x: (x[0], -x[1]), reverse=True)
    results = []
    for score, start, doc, chunk in candidates[:limit]:
        results.append({'title': f'{doc["title"]} · 片段 {start // 1050 + 1}', 'url': '', 'content': chunk,
                        'type': 'document', 'document_id': doc['id'], 'offset': start, 'retrieval_score': round(score, 3)})
    return results
