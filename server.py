from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlencode
from urllib.request import Request, build_opener, ProxyHandler, HTTPSHandler, HTTPCookieProcessor
from urllib.error import HTTPError, URLError
import html as html_utils
import json
import re
import ssl
from http.cookiejar import CookieJar

SIMS_FORM_URL = 'https://simsweb.uitm.edu.my/SPORTAL_APP/exam_schedule/index.htm'
SIMS_URL = 'https://simsweb.uitm.edu.my/SPORTAL_APP/exam_schedule/index_result.cfm'
MATRIC_URL = 'https://uitmtimetable.com/api.php?fetchDataMatrix'
AIMS_SEARCH_URL = 'https://aims.uitm.edu.my/index.cfm/page/search'

MONTHS = {
    'JAN': 1, 'FEB': 2, 'MAR': 3, 'APR': 4, 'MAY': 5, 'JUN': 6,
    'JUL': 7, 'AUG': 8, 'SEP': 9, 'OCT': 10, 'NOV': 11, 'DEC': 12,
}

COURSE_NAME_TRANSLATIONS = {
    'PENGENALAN KEPADA KOMUNIKASI DATA DAN PERANGKAIAN': 'Introduction to Data Communication and Networking',
    'INTRODUCTION TO DATA COMMUNICATIONS AND NETWORKING': 'Introduction to Data Communication and Networking',
    'PENGENALAN KEPADA KEBARANGKALIAN DAN STATISTIK': 'Introduction to Probability and Statistics',
    'ELEKTRONIK DIGITAL': 'Digital Electronics',
}


def normalize_code(value):
    return re.sub(r'\s+', '', value or '').strip().upper()


def parse_codes(value):
    seen = []
    for code in re.split(r'[\s,;]+', value or ''):
        code = normalize_code(code)
        if re.match(r'^[A-Z]{2,4}\d{3}[A-Z]?$', code) and code not in seen:
            seen.append(code)
    return seen


def normalize_subject_name(value):
    name = re.sub(r'\s+', ' ', value or '').strip()
    if not name:
        return ''
    return COURSE_NAME_TRANSLATIONS.get(name.upper(), name).upper()

def parse_time(value):
    match = re.search(r'(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)', value or '', flags=re.I)
    if not match:
        return 0, 0
    hour = int(match.group(1))
    minute = int(match.group(2))
    meridiem = match.group(3).upper()
    if meridiem == 'PM' and hour != 12:
        hour += 12
    if meridiem == 'AM' and hour == 12:
        hour = 0
    return hour, minute


def iso_datetime(year, month, day, hour, minute):
    return f'{year:04d}-{month:02d}-{day:02d}T{hour:02d}:{minute:02d}:00'


def parse_exam_rows(html, requested_codes):
    rows = re.findall(r'<tr[^>]*class="gradeU"[^>]*>(.*?)</tr>', html, flags=re.I | re.S)
    found = []
    for row in rows:
        cells = re.findall(r'<td[^>]*>(.*?)</td>', row, flags=re.I | re.S)
        cleaned = [re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', cell)).strip() for cell in cells]
        if len(cleaned) < 3:
            continue
        code = normalize_code(cleaned[0])
        date_text = cleaned[1].upper()
        time_text = cleaned[2]
        match = re.match(r'(\d{1,2})-([A-Z]{3})-(\d{2,4})', date_text)
        if not code or not match:
            continue
        day = int(match.group(1))
        month = MONTHS.get(match.group(2), 1)
        raw_year = int(match.group(3))
        year = 2000 + raw_year if raw_year < 100 else raw_year
        time_parts = [part.strip() for part in time_text.split('-')]
        start_hour, start_minute = parse_time(time_parts[0] if time_parts else '')
        end_hour, end_minute = parse_time(time_parts[1] if len(time_parts) > 1 else '')
        found.append({
            'code': code,
            'dateStr': iso_datetime(year, month, day, start_hour, start_minute),
            'endTimeStr': iso_datetime(year, month, day, end_hour, end_minute),
            'rawDate': cleaned[1],
            'rawTime': time_text,
            'location': 'Check official venue slip',
            'source': 'SIMS exam schedule',
        })
    found_codes = {item['code'] for item in found}
    return {'found': found, 'missing': [code for code in requested_codes if code not in found_codes]}


def make_opener():
    context = ssl._create_unverified_context()
    return build_opener(ProxyHandler({}), HTTPCookieProcessor(CookieJar()), HTTPSHandler(context=context))


def post_form(url, payload, opener=None, referer=None):
    data = payload.encode('utf-8')
    headers = {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'User-Agent': 'Mozilla/5.0 UiTM Finals Local Proxy',
        'X-Requested-With': 'XMLHttpRequest',
    }
    if referer:
        headers['Referer'] = referer
    req = Request(url, data=data, headers=headers)
    opener = opener or make_opener()
    with opener.open(req, timeout=20) as response:
        return response.read().decode('utf-8', errors='replace')


def fetch_sims_exam_html(codes):
    opener = make_opener()
    opener.addheaders = [('User-Agent', 'Mozilla/5.0 UiTM Finals Local Proxy')]
    with opener.open(SIMS_FORM_URL, timeout=20) as response:
        response.read()
    return post_form(SIMS_URL, urlencode({'search_course': ','.join(codes)}), opener=opener, referer=SIMS_FORM_URL)


def strip_html(value):
    return html_utils.unescape(re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', value or '')).strip())


def parse_aims_course_title(html, code):
    code = normalize_code(code)
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', html, flags=re.I | re.S):
        link_match = re.search(r'<a[^>]*>\s*(' + re.escape(code) + r')\s*-\s*(.*?)</a>', row, flags=re.I | re.S)
        if link_match:
            return normalize_subject_name(strip_html(link_match.group(2)))
    return ''


from concurrent.futures import ThreadPoolExecutor

def fetch_single_aims_title(code):
    try:
        opener = make_opener()
        html = post_form(
            AIMS_SEARCH_URL,
            urlencode({'searchType': 'modules', 'm': code}),
            opener=opener,
            referer=AIMS_SEARCH_URL,
        )
        return code, parse_aims_course_title(html, code)
    except Exception:
        return code, ''


def fetch_aims_course_titles(codes):
    titles = {}
    if not codes:
        return titles
    with ThreadPoolExecutor(max_workers=min(len(codes), 10)) as executor:
        results = executor.map(fetch_single_aims_title, codes)
        for code, title in results:
            if title:
                titles[code] = title
    return titles



def enrich_exam_subjects(result):
    titles = fetch_aims_course_titles([exam['code'] for exam in result.get('found', [])])
    for exam in result.get('found', []):
        if titles.get(exam['code']):
            exam['subjectName'] = titles[exam['code']]
            exam['subjectSource'] = 'AIMS course search'
    return result


class Handler(SimpleHTTPRequestHandler):
    def send_json(self, status, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_post(self):
        length = int(self.headers.get('Content-Length', '0'))
        return self.rfile.read(length).decode('utf-8', errors='replace')

    def do_POST(self):
        try:
            fields = parse_qs(self.read_post())
            path = self.headers.get('x-vercel-forwarded-path') or self.path
            path = path.split('?')[0]

            if path == '/api/exams' or path.endswith('/exams'):
                codes = parse_codes(fields.get('codes', [''])[0] or fields.get('search_course', [''])[0])
                if not codes:
                    self.send_json(400, {'error': 'No valid course codes provided.'})
                    return
                html = fetch_sims_exam_html(codes)
                self.send_json(200, enrich_exam_subjects(parse_exam_rows(html, codes)))
                return

            if path == '/api/matric' or path.endswith('/matric'):
                student_id = (fields.get('studentId', [''])[0] or '').strip()
                if not student_id:
                    self.send_json(400, {'error': 'Student ID is required.'})
                    return
                text = post_form(MATRIC_URL, urlencode({'studentId': student_id}))
                if text.startswith('Alert_Error:'):
                    self.send_json(404, {'error': re.sub(r'<[^>]+>', '', text.replace('Alert_Error:', '')).strip()})
                    return
                rows = json.loads(text)
                codes = []
                subjects = []
                for row in rows:
                    code = normalize_code(row.get('subject') or row.get('course') or row.get('code'))
                    if not code or code in codes:
                        continue
                    codes.append(code)
                    english_name = normalize_subject_name(
                        row.get('subject_name_en')
                        or row.get('subject_english_name')
                        or row.get('english_name')
                        or row.get('course_name_en')
                        or row.get('course_english_name')
                        or row.get('subject_name')
                        or ''
                    )
                    subjects.append({
                        'code': code,
                        'subjectName': english_name,
                        'officialSubjectName': (row.get('subject_name') or '').strip(),
                        'lecturer': (row.get('lecturer') or '').strip(),
                    })
                aims_titles = fetch_aims_course_titles(codes)
                for subject in subjects:
                    if aims_titles.get(subject['code']):
                        subject['subjectName'] = aims_titles[subject['code']]
                        subject['subjectSource'] = 'AIMS course search'
                self.send_json(200, {'codes': codes, 'subjects': subjects})
                return

            self.send_json(404, {'error': 'Unknown API route.'})
        except (HTTPError, URLError, TimeoutError) as exc:
            self.send_json(502, {'error': f'External fetch failed: {exc}'})
        except Exception as exc:
            self.send_json(500, {'error': str(exc)})


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 8001), Handler)
    print('Serving UiTM Finals with API proxy at http://localhost:8001/')
    server.serve_forever()








