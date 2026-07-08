import os
import json
import urllib.request
# pyrefly: ignore [missing-import]
from pywebpush import webpush, WebPushException

# Replace these with your actual Supabase credentials if running locally
SUPABASE_URL = "https://gmxtkxpqerfneqietwhk.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdteHRreHBxZXJmbmVxaWV0d2hrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MzI2Nzg4MiwiZXhwIjoyMDk4ODQzODgyfQ.mtVwf49wqaTNQhNQVsOIgMx7pWRTHFKGUZfNi6GQyDw"

def fetch_subscriptions():
    url = f"{SUPABASE_URL.rstrip('/')}/rest/v1/subscriptions"
    req = urllib.request.Request(
        url,
        headers={
            'apikey': SUPABASE_KEY,
            'Authorization': f'Bearer {SUPABASE_KEY}',
            'Content-Type': 'application/json'
        },
        method='GET'
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return json.loads(res.read().decode('utf-8'))
    except Exception as e:
        print(f"Failed to fetch subscriptions: {e}")
        return []

def send_test_push():
    from server import fetch_sims_exam_html, parse_exam_rows, generate_zus_notification, get_days_left_myt
    from datetime import datetime, timedelta, timezone

    if SUPABASE_KEY == "YOUR_SUPABASE_SERVICE_ROLE_KEY_HERE":
        print("\n[!] Error: Please open send_push.py and replace 'YOUR_SUPABASE_SERVICE_ROLE_KEY_HERE'")
        print("    with your actual SUPABASE_SERVICE_ROLE_KEY from your Supabase settings.")
        return

    print("Fetching subscriptions from Supabase...")
    subscriptions = fetch_subscriptions()
    if not subscriptions:
        print("No subscriptions found in the database. Make sure you enable alerts on your phone first!")
        return

    print(f"Found {len(subscriptions)} subscription(s). Sending push notifications...")
    
    # Determine time of day for Gen Z context
    myt = timezone(timedelta(hours=8))
    now_myt = datetime.now(myt)
    hour = now_myt.hour

    if 4 <= hour < 12:
        time_of_day = "morning"
    elif 12 <= hour < 19:
        time_of_day = "midday"
    else:
        time_of_day = "night"

    # Resolve the path to private_key.pem relative to this script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    private_key_path = os.path.join(script_dir, "private_key.pem")
    
    for sub in subscriptions:
        sub_data = sub.get("subscription_data")
        subjects = sub.get("subjects") or []
        
        if not sub_data:
            continue
            
        # Get custom ZUS message
        if subjects:
            try:
                html = fetch_sims_exam_html(subjects)
                exams_result = parse_exam_rows(html, subjects)
                found_exams = exams_result.get('found', [])
            except Exception as e:
                print(f" - Failed to fetch exams for {subjects}: {e}")
                continue
                
            closest_exam = None
            min_days_left = 9999
            for exam in found_exams:
                days_left = get_days_left_myt(exam['dateStr'])
                if 0 <= days_left < min_days_left:
                    min_days_left = days_left
                    closest_exam = exam
                    
            if closest_exam:
                subject_code = closest_exam['code']
                days_left = min_days_left
                if days_left == 0:
                    line1 = f"Exam {subject_code} harini weh 😮💨"
                    line2 = "Good luck, all the best! 💪"
                else:
                    line1, line2 = generate_zus_notification(subject_code, days_left, time_of_day)
            else:
                # Fallback if no upcoming exams
                line1 = "Eh, dah start study ke? 👀"
                line2 = "Touch 1 chapter je dulu fr"
        else:
            # Fallback if subscription has no subjects saved yet
            line1 = "Eh, dah start study ke? 👀"
            line2 = "Touch 1 chapter je dulu fr"

        payload = {
            "title": line1,
            "body": line2,
            "url": "https://www.finalsplus.my/"
        }
        
        try:
            webpush(
                subscription_info=sub_data,
                data=json.dumps(payload),
                vapid_private_key=private_key_path,
                vapid_claims={"sub": "mailto:test@finalsplus.my"}
            )
            print(f" - Sent successfully (ZUS-Style) to: {sub_data.get('endpoint')[:60]}...")
            print(f"   [Title]: {line1}")
            print(f"   [Body] : {line2}")
        except WebPushException as ex:
            print(f" - Failed for {sub_data.get('endpoint')[:60]}: {ex}")

if __name__ == "__main__":
    send_test_push()
