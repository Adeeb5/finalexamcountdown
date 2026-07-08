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
    'BAHASA INGGERIS': 'English Language',
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
            urlencode({'searchType': 'modules', 'p': code}),
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


def kv_redis_command(cmd, args):
    import os
    import urllib.request
    import json
    kv_url = os.environ.get('KV_REST_API_URL')
    kv_token = os.environ.get('KV_REST_API_TOKEN')
    if not kv_url or not kv_token:
        return None
    
    url = f"{kv_url}"
    payload = json.dumps([cmd] + args).encode('utf-8')
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            'Authorization': f'Bearer {kv_token}',
            'Content-Type': 'application/json'
        },
        method='POST'
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            return json.loads(res.read().decode('utf-8'))
    except Exception as e:
        print(f"Vercel KV Error: {e}")
        return None


def save_to_supabase(subscription_info, subjects):
    import os
    import urllib.request
    import json
    
    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_ANON_KEY')
    if not supabase_url or not supabase_key:
        return None
        
    endpoint = subscription_info.get('endpoint')
    if not endpoint:
        return None
        
    url = f"{supabase_url.rstrip('/')}/rest/v1/subscriptions?on_conflict=endpoint"
    payload = json.dumps({
        'endpoint': endpoint,
        'subscription_data': subscription_info,
        'subjects': subjects
    }).encode('utf-8')
    
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            'apikey': supabase_key,
            'Authorization': f'Bearer {supabase_key}',
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates'
        },
        method='POST'
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            res.read()
            return True
    except Exception as e:
        print(f"Supabase Error: {e}")
        return False


def generate_zus_notification(subject, days_left, time_of_day):
    import random
    
    # Morning templates
    morning_templates = [
        ("{days_left} hari je lagi {subject} 😶", "Buka notes 10 min je dulu"),
        ("{subject} is calling 🤙", "D-{days_left} weh, hi dulu jap"),
        ("Jangan buat-buat lupa", "Touch 1 chapter je harini"),
        ("Countdown is real 🙄", "Buka jap lepas tu sambung scroll")
    ]
    
    # Midday templates
    midday_templates = [
        ("{subject} is calling 🤙", "It's study o'clock 👀"),
        ("Eh {subject} dah sentuh ke belum?", "15 min je janji jalan"),
        ("Dah lunch? Study jap", "Scroll boleh tunggu {subject} tak"),
        ("Jangan ghost {subject} pls", "Buka sekarang future you thanks")
    ]
    
    # Night templates
    night_templates = [
        ("{days_left} hari lagi weh 😮💨", "Tutup buku dulu recharge"),
        ("Jangan burn out malam ni", "{subject} tunggu esok not tonight"),
        ("Brain need rest fr", "Dah cukup grind harini"),
        ("Tidur awal = auto win", "Esok kita sambung balik")
    ]
    
    if time_of_day == "morning":
        tpl = random.choice(morning_templates)
    elif time_of_day == "midday":
        tpl = random.choice(midday_templates)
    else:
        tpl = random.choice(night_templates)
        
    line1 = tpl[0].format(subject=subject, days_left=str(days_left))
    line2 = tpl[1].format(subject=subject, days_left=str(days_left))
    
    return line1, line2


def get_days_left_myt(exam_date_str):
    from datetime import datetime, timedelta, timezone
    try:
        # Parse exam date
        exam_dt = datetime.fromisoformat(exam_date_str.split('Z')[0])
        # Get current time in MYT (UTC + 8 hours)
        myt = timezone(timedelta(hours=8))
        now_myt = datetime.now(myt)
        # Extract dates (ignoring time) to get absolute difference in days
        exam_date = exam_dt.date()
        today_date = now_myt.date()
        return (exam_date - today_date).days
    except Exception as e:
        print(f"Error parsing date {exam_date_str}: {e}")
        return -999


def send_cron_notifications():
    import os
    import urllib.request
    import json
    from datetime import datetime, timedelta, timezone
    from pywebpush import webpush, WebPushException

    supabase_url = os.environ.get('SUPABASE_URL')
    supabase_key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY') or os.environ.get('SUPABASE_ANON_KEY')
    if not supabase_url or not supabase_key:
        print("Cron Alert Error: Supabase credentials missing")
        return {"error": "Supabase credentials missing"}

    # Determine time of day based on current hour in MYT (UTC+8)
    myt = timezone(timedelta(hours=8))
    now_myt = datetime.now(myt)
    hour = now_myt.hour

    if 4 <= hour < 12:
        time_of_day = "morning"
    elif 12 <= hour < 19:
        time_of_day = "midday"
    else:
        time_of_day = "night"

    # 1. Fetch all subscriptions from Supabase
    url = f"{supabase_url.rstrip('/')}/rest/v1/subscriptions"
    req = urllib.request.Request(
        url,
        headers={
            'apikey': supabase_key,
            'Authorization': f'Bearer {supabase_key}',
            'Content-Type': 'application/json'
        },
        method='GET'
    )
    
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            subscriptions = json.loads(res.read().decode('utf-8'))
    except Exception as e:
        print(f"Cron Alert Error: Failed to fetch subscriptions: {e}")
        return {"error": f"Failed to fetch subscriptions: {e}"}

    results = []
    
    script_dir = os.path.dirname(os.path.abspath(__file__))
    private_key_path = os.path.join(script_dir, "private_key.pem")
    if not os.path.exists(private_key_path):
         print("Cron Alert Error: private_key.pem missing")
         return {"error": "private_key.pem missing"}

    # 2. Iterate through each subscription
    for sub in subscriptions:
        sub_data = sub.get("subscription_data")
        subjects = sub.get("subjects") or []
        
        if not sub_data or not subjects:
            continue
            
        # 3. Fetch exam schedules for these subjects in a single batch
        try:
            html = fetch_sims_exam_html(subjects)
            exams_result = parse_exam_rows(html, subjects)
            found_exams = exams_result.get('found', [])
        except Exception as e:
            print(f"Cron Alert: Failed to fetch exams for {subjects}: {e}")
            continue

        if not found_exams:
            continue

        # 4. Find the closest upcoming exam (days_left >= 0)
        closest_exam = None
        min_days_left = 9999
        
        for exam in found_exams:
            days_left = get_days_left_myt(exam['dateStr'])
            if 0 <= days_left < min_days_left:
                min_days_left = days_left
                closest_exam = exam

        if closest_exam is None:
            continue

        subject_code = closest_exam['code']
        days_left = min_days_left

        # Only send notifications if the exam is within 30 days
        if days_left > 30:
            continue

        # 5. Generate ZUS-style Gen Z copy
        if days_left == 0:
            line1 = f"Exam {subject_code} harini weh 😮💨"
            line2 = "Good luck, all the best! 💪"
        else:
            line1, line2 = generate_zus_notification(subject_code, days_left, time_of_day)

        payload = {
            "title": line1,
            "body": line2,
            "url": "https://www.finalsplus.my/"
        }

        # 6. Send the push notification
        try:
            webpush(
                subscription_info=sub_data,
                data=json.dumps(payload),
                vapid_private_key=private_key_path,
                vapid_claims={"sub": "mailto:admin@finalsplus.my"}
            )
            results.append({"endpoint": sub_data.get("endpoint")[:40] + "...", "status": "success"})
        except WebPushException as ex:
            print(f"Cron Alert push failed: {ex}")
            results.append({"endpoint": sub_data.get("endpoint")[:40] + "...", "status": "failed", "error": str(ex)})

    return {"status": "completed", "sent_count": len([r for r in results if r["status"] == "success"]), "details": results}


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, X-Vercel-Forwarded-Path')
        self.send_header('X-Frame-Options', 'SAMEORIGIN')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'strict-origin')
        self.send_header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()')
        self.send_header('Content-Security-Policy', "default-src 'self' *; script-src 'self' https://unpkg.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src *; manifest-src 'self'; font-src 'self' data:; frame-ancestors 'none';")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        import os
        
        clean_path = self.path.split('?')[0]
        if clean_path == '/api/cron-alert' or clean_path.endswith('/cron-alert'):
            res = send_cron_notifications()
            status = 200 if "error" not in res else 500
            self.send_json(status, res)
            return

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
            raw_data = self.read_post()
            fields = parse_qs(raw_data)
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
                # Final fallback to official (Malay) name if both timetable and AIMS had no English title
                for subject in subjects:
                    if not subject['subjectName']:
                        subject['subjectName'] = subject['officialSubjectName']
                self.send_json(200, {'codes': codes, 'subjects': subjects})
                return

            if path == '/api/subscribe' or path.endswith('/subscribe'):
                try:
                    payload_data = json.loads(raw_data)
                    if isinstance(payload_data, dict) and "subscription" in payload_data:
                        subscription_info = payload_data.get("subscription")
                        subjects = payload_data.get("subjects", [])
                    else:
                        subscription_info = payload_data
                        subjects = []
                    
                    # Try Supabase first
                    supabase_result = save_to_supabase(subscription_info, subjects)
                    if supabase_result is True:
                        self.send_json(200, {'status': 'success', 'message': 'Subscription stored in Supabase.'})
                        return
                    
                    # Try Vercel KV second (production environment)
                    kv_result = kv_redis_command('SADD', ['subscriptions', json.dumps(subscription_info)])
                    if kv_result is not None:
                        self.send_json(200, {'status': 'success', 'message': 'Subscription stored in Vercel KV.'})
                    else:
                        # Fallback to local file (development environment)
                        subscriptions = []
                        db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'subscriptions.json')
                        if os.path.exists(db_path):
                            try:
                                with open(db_path, 'r', encoding='utf-8') as f:
                                    subscriptions = json.load(f)
                            except Exception:
                                pass
                        if subscription_info not in subscriptions:
                            subscriptions.append(subscription_info)
                            with open(db_path, 'w', encoding='utf-8') as f:
                                json.dump(subscriptions, f, indent=2)
                        self.send_json(200, {'status': 'success', 'message': 'Subscription stored in local file.'})
                except Exception as e:
                    self.send_json(400, {'error': f'Invalid subscription format: {str(e)}'})
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








