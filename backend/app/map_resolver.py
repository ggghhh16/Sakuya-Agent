"""Local extraction and conservative matching; only place words reach AMap."""
import re
import unicodedata

RESOLVER_VERSION = 'building-v2'


def location_input(entry):
    return [entry.get(key, '') or '' for key in ('location', 'title', 'notes')]


def clean_place(value):
    # Meeting URLs/passwords are not street addresses.
    value = re.split(r'https?://|www\.', value, flags=re.I)[0].strip()
    value = re.sub(r'^(?:地点|地址|位置|location|venue)\s*[:：]\s*', '', value, flags=re.I)
    value = re.split(r'[\n;；。]|(?:，|,)\s*(?:备注|联系人|电话)', value)[0].strip(' ,，:：')
    if re.match(r'^(?:线上|在线|远程|腾讯会议|飞书会议|zoom|teams|google meet)(?:\b|会议|[\s:：])', value, re.I):
        return ''
    if not value or len(value) > 200 or re.fullmatch(r'(?:线上|在线|远程|待定|家里|公司|办公室|学校|图书馆|会议室|食堂|医院|酒店|online|remote|tbd|zoom|腾讯会议|飞书会议|teams)', value, re.I):
        return ''
    return value


def extract_location(entry):
    location, title, notes = location_input(entry)
    # An explicit online venue must not accidentally use a place from the notes.
    if location.strip():
        return clean_place(location)
    for text in (notes, title):
        match = re.search(r'(?:^|[\n，,；;。])\s*(?:地点|地址|位置|location|venue)\s*[:：]\s*([^\n；;。]+)', text, re.I)
        if match:
            return clean_place(match[1])
    # Delimit the place before an activity; never send an entire task/notes blob.
    for text in (title, notes):
        match = re.search(r'(?:在|前往|去|到)\s*([^\n，,；;。！？!?]{2,100}?)(?=\s*(?:参加|开会|上课|自习|学习|取件|取快递|吃饭|集合|见面|面试|报到|签到|办理|参观|看病|复诊|还书|借书|买|办事)|[，,；;。！？!?\n]|$)', text)
        if match:
            return clean_place(match[1])
    # A place-first title such as “暨南大学图书馆 自习”.
    match = re.match(r'^([^\n，,；;。]{2,100}?(?:大学|学院|校区|图书馆|教学楼|实验楼|大厦|中心|医院|酒店|餐厅|车站|机场|公园|园区|体育馆|[A-Za-z0-9一二三四五六七八九十]+栋))(?=\s|[，,:：]|开会|上课|自习|学习|面试|还书|借书|$)', title)
    return clean_place(match[1]) if match else ''


def normalized(value):
    return re.sub(r'[\W_]+', '', unicodedata.normalize('NFKC', value)).casefold()


def building_query(query):
    """Separate a building from its room number without removing street numbers."""
    value = unicodedata.normalize('NFKC', query).strip()
    value = re.sub(r'((?:大楼|楼|馆|中心|栋|座))\s*[-—·]?\s*[A-Za-z]?\d{2,5}\s*(?:教室|会议室|室|房间|房)?$', r'\1', value)
    campus = re.match(r'^(.*?(?:校区|校本部|园区))\s*[·•|｜/，,\-]?\s*(.+)$', value)
    if campus:
        context, building = campus.groups()
        # Course locations often repeat the campus name before the building.
        tag = re.search(r'(?:大学|学院)([^大学学院]{1,8})校区$', context)
        if tag and building.startswith(tag[1]):
            building = building[len(tag[1]):].strip()
        # Campus timetable codes encode room/wing information after 教/实.
        # Keep those details on the entry; search at building level only.
        code = re.fullmatch(r'[A-Za-z]?(教|实)[A-Za-z]{0,4}[-—]?\d{2,5}(?:室)?', building)
        if code:
            building = '教学楼' if code[1] == '教' else '实验楼'
        value = f'{context} {building}'
    return value


def search_queries(query):
    building = building_query(query)
    aliases = building.replace('教学大楼', '教学楼').replace('实验大楼', '实验楼')
    expanded = aliases.replace('教学楼', '教学大楼').replace('实验楼', '实验大楼')
    return list(dict.fromkeys([building, aliases, expanded]))


def match_text(value):
    return normalized(building_query(value).replace('教学大楼', '教学楼').replace('实验大楼', '实验楼'))


def match_place(query, places):
    """Reject unrelated results and tied names instead of trusting result order."""
    needle = match_text(query)
    ranked = []
    seen = set()
    for place in places:
        identity = (round(place['lng'], 6), round(place['lat'], 6), place['name'])
        if identity in seen:
            continue
        seen.add(identity)
        name, address = match_text(place['name']), match_text(place['address'])
        if needle == name:
            score = 100
        elif needle == address or needle == address + name:
            score = 90
        elif needle in name:
            score = 80
        elif len(needle) >= 6 and needle in address:
            score = 75
        elif name and name in needle and needle in address + name:
            score = 70
        else:
            score = 0
        if score:
            ranked.append((score, place))
    ranked.sort(key=lambda item: item[0], reverse=True)
    if not ranked:
        return None, 'not_found'
    if len(ranked) > 1 and ranked[0][0] == ranked[1][0]:
        return None, 'ambiguous'
    return ranked[0][1], 'resolved'
