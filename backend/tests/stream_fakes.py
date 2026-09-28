import json
import httpx


def model_response(message, tokens=0):
    chunks = []
    def add(delta, finish=None):
        chunks.append({'choices': [{'index': 0, 'delta': delta, 'finish_reason': finish}]})
    if message.get('reasoning_content'):
        add({'reasoning_content': message['reasoning_content']})
    for char in message.get('content') or '':
        add({'content': char})
    for index, call in enumerate(message.get('tool_calls', [])):
        add({'tool_calls': [{'index': index, 'id': call['id'], 'type': 'function', 'function': {'name': call['function']['name'], 'arguments': ''}}]})
        for char in call['function']['arguments']:
            add({'tool_calls': [{'index': index, 'function': {'arguments': char}}]})
    add({}, 'tool_calls' if message.get('tool_calls') else 'stop')
    chunks.append({'choices': [], 'usage': {'total_tokens': tokens}})
    body = ''.join('data: ' + json.dumps(chunk, ensure_ascii=False) + '\n\n' for chunk in chunks) + 'data: [DONE]\n\n'
    return httpx.Response(200, content=body, headers={'content-type': 'text/event-stream'})
