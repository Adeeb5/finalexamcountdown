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
    context = ssl.create_default_context()
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


shared_opener = None

def get_shared_opener():
    global shared_opener
    if shared_opener is None:
        shared_opener = make_opener()
        shared_opener.addheaders = [('User-Agent', 'Mozilla/5.0 UiTM Finals Proxy')]
        try:
            with shared_opener.open(SIMS_FORM_URL, timeout=15) as response:
                response.read()
        except Exception:
            pass
    return shared_opener

def fetch_sims_exam_html(codes):
    opener = get_shared_opener()
    try:
        return post_form(SIMS_URL, urlencode({'search_course': ','.join(codes)}), opener=opener, referer=SIMS_FORM_URL)
    except Exception:
        global shared_opener
        shared_opener = None
        opener = get_shared_opener()
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
    def end_headers(self):
        self.send_header('X-Frame-Options', 'SAMEORIGIN')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'strict-origin')
        self.send_header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self' https://unpkg.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://simsweb.uitm.edu.my https://uitmtimetable.com; font-src 'self' data:; frame-ancestors 'none';")
        super().end_headers()

    def do_GET(self):
        import os
        path = self.translate_path(self.path)
        if not os.path.exists(path) and not self.path.startswith('/api/'):
            self.send_response(404)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            try:
                with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '404.html'), 'rb') as f:
                    self.wfile.write(f.read())
            except Exception:
                self.wfile.write(b"404 Not Found")
            return
        super().do_GET()

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
                skip_aims = (fields.get('skip_aims', [''])[0] or '').lower() == 'true'
                if not codes:
                    self.send_json(400, {'error': 'No valid course codes provided.'})
                    return
                html = fetch_sims_exam_html(codes)
                exams_result = parse_exam_rows(html, codes)
                if not skip_aims:
                    exams_result = enrich_exam_subjects(exams_result)
                self.send_json(200, exams_result)
                return

            if path == '/api/matric' or path.endswith('/matric'):
                student_id = (fields.get('studentId', [''])[0] or '').strip()
                if not student_id:
                    self.send_json(400, {'error': 'Student ID is required.'})
                    return
                if not re.match(r'^[a-zA-Z0-9]+$', student_id):
                    self.send_json(400, {'error': 'Invalid Student ID format. Only alphanumeric characters are allowed.'})
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
                codes_needing_titles = [s['code'] for s in subjects if not s['subjectName']]
                if codes_needing_titles:
                    aims_titles = fetch_aims_course_titles(codes_needing_titles)
                    for subject in subjects:
                        if not subject['subjectName'] and aims_titles.get(subject['code']):
                            subject['subjectName'] = aims_titles[subject['code']]
                            subject['subjectSource'] = 'AIMS course search'
                self.send_json(200, {'codes': codes, 'subjects': subjects})
                return

            if path == '/api/chat' or path.endswith('/chat'):
                import os
                from urllib.request import urlopen
                api_key = os.environ.get('GEMINI_API_KEY')
                if not api_key:
                    self.send_json(400, {'error': 'GEMINI_API_KEY is not configured on the server. Please add it to your environment variables.'})
                    return
                
                post_body = self.read_post()
                try:
                    payload = json.loads(post_body)
                except Exception:
                    fields = parse_qs(post_body)
                    payload = {
                        'message': fields.get('message', [''])[0],
                        'history': json.loads(fields.get('history', ['[]'])[0]),
                        'exams': json.loads(fields.get('exams', ['[]'])[0])
                    }
                
                contents = []
                history = payload.get('history', [])
                for msg in history:
                    contents.append({
                        "role": "user" if msg.get("role") == "user" else "model",
                        "parts": [{"text": msg.get("content")}]
                    })
                
                user_msg = payload.get('message', '')
                contents.append({
                    "role": "user",
                    "parts": [{"text": user_msg}]
                })
                
                system_instruction = (
                    "You are 'Finals+ AI', a helpful and friendly academic assistant for UiTM students. "
                    "You help students with their exams, study tips, and academic schedules. "
                    "Reply naturally in a mix of Malay and English (Bahasa Melayu / Manglish / Santai) that UiTM students typically use. "
                    "Be supportive, encouraging, and friendly. Use formatting like bullet points or bold text to make it easy to read.\n\n"
                    "Current Local Time/Date: Sunday, June 28, 2026.\n\n"
                    "UiTM Academic Calendar Session II 2025/2026 (Current Semester):\n"
                    "- Lectures: 30 March 2026 to 24 May 2026 (8 weeks)\n"
                    "- Mid-Semester/Special Break: 25 May 2026 to 2 June 2026 (1 week)\n"
                    "- Lectures Continued: 3 June 2026 to 12 July 2026 (6 weeks)\n"
                    "- Revision Week: 13 July 2026 to 19 July 2026 (1 week)\n"
                    "- Final Examinations/Assessments: 20 July 2026 to 9 August 2026 (3 weeks)\n"
                    "- Semester Break: 10 August 2026 to 4 October 2026 (8 weeks)\n\n"
                )
                
                loaded_exams = payload.get('exams', [])
                if loaded_exams:
                    system_instruction += "The student currently has these final exams saved in their countdown list:\n"
                    for exam in loaded_exams:
                        system_instruction += f"- Code: {exam.get('code')}, Subject: {exam.get('subjectName') or 'N/A'}, Date: {exam.get('dateStr') or 'N/A'}, Location: {exam.get('location') or 'N/A'}\n"
                    system_instruction += "\n"
                
                req_data = {
                    "contents": contents,
                    "systemInstruction": {
                        "parts": [{"text": system_instruction}]
                    }
                }
                
                req_body = json.dumps(req_data).encode('utf-8')
                req_url = f"https://generativelanguage.googleapis.com/v1/models/gemini-1.5-flash:generateContent?key={api_key}"
                
                req = Request(
                    req_url,
                    data=req_body,
                    headers={'Content-Type': 'application/json'}
                )
                
                try:
                    with urlopen(req, timeout=8) as resp:
                        resp_data = json.loads(resp.read().decode('utf-8'))
                        reply = resp_data['candidates'][0]['content']['parts'][0]['text']
                        self.send_json(200, {'reply': reply})
                except Exception as e:
                    import traceback
                    traceback.print_exc()
                    self.send_json(500, {'error': f'AI request failed: {str(e)}'})
                return

            self.send_json(404, {'error': 'Unknown API route.'})
        except (HTTPError, URLError, TimeoutError) as exc:
            print(f"Proxy fetch error: {exc}")
            self.send_json(502, {'error': 'External request failed.'})
        except Exception as exc:
            print(f"Server exception: {exc}")
            self.send_json(500, {'error': 'Internal server error.'})


if __name__ == '__main__':
    server = ThreadingHTTPServer(('127.0.0.1', 8001), Handler)
    print('Serving UiTM Finals with API proxy at http://localhost:8001/')
    server.serve_forever()








