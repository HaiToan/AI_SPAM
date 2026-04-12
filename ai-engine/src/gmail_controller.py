import os
import time
import psycopg2
import requests
from datetime import datetime
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

# --- CẤU HÌNH ---
SCOPES = ['https://www.googleapis.com/auth/gmail.modify']
AI_SERVICE_URL = "http://localhost:8000/predict"
DB_CONFIG = {
    "host": "localhost",
    "database": "gmail_spam_db",
    "user": "postgres",
    "password": "admin",
    "port": 5432
}

processed_ids = set()

def get_gmail_service():
    creds = None
    if os.path.exists('token.json'):
        creds = Credentials.from_authorized_user_file('token.json', SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file('../../credentials.json', SCOPES)
            creds = flow.run_local_server(port=0)
        with open('token.json', 'w') as token:
            token.write(creds.to_json())
    return build('gmail', 'v1', credentials=creds)

def run_filter():
    service = get_gmail_service()
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()

    # LẤY 5 MAIL GẦN NHẤT TRONG THƯ MỤC CHÍNH (INBOX)
    results = service.users().messages().list(
    userId='me', 
    q='(label:INBOX OR label:SPAM) is:unread', 
    maxResults=5
).execute()
    messages = results.get('messages', [])

    if not messages:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] 💤 Inbox đang trống.")
    else:
        new_mail_found = False
        for msg in messages:
            msg_id = msg['id']
            
            # KIỂM TRA TRÙNG (Database & RAM)
            cur.execute("SELECT id FROM spam_logs WHERE email_snippet LIKE %s LIMIT 1", (f"%{msg_id}%",))
            if cur.fetchone() or msg_id in processed_ids:
                continue 

            new_mail_found = True
            try:
                message = service.users().messages().get(userId='me', id=msg_id, format='full').execute()
                headers = message.get('payload', {}).get('headers', [])
                subject = next((header['value'] for header in headers if header['name'] == 'Subject'), "No Subject")
                snippet = message.get('snippet', '')
                
                # Lưu ID vào nội dung để đối chiếu Database lần sau
                full_content = f"[{msg_id}] {subject}. {snippet}"

                # 1. Gọi AI dự đoán
                response = requests.get(AI_SERVICE_URL, params={"content": full_content}, timeout=5)
                prediction = response.json().get('prediction', 'ham')

                # 2. Lưu vào Database
                cur.execute(
                    "INSERT INTO spam_logs (email_snippet, prediction, processed_at) VALUES (%s, %s, NOW())",
                    (full_content[:255], prediction)
                )
                conn.commit()
                processed_ids.add(msg_id)

                # 3. LỆNH DI CHUYỂN VÀO THƯ RÁC (SPAM)
                if prediction == 'spam':
                    service.users().messages().modify(
                        userId='me', 
                        id=msg_id,
                        body={
                            'removeLabelIds': ['INBOX'], 
                            'addLabelIds': ['SPAM']      
                        }
                    ).execute()
                    status = "🚩 SPAM (Đã đưa vào thư rác)"
                else:
                    status = "✅ HAM"

                print(f"[{datetime.now().strftime('%H:%M:%S')}] MỚI: {status} | {subject[:40]}...")

            except Exception as e:
                print(f"   ❌ Lỗi mail {msg_id}: {e}")

        if not new_mail_found:
            print(f"[{datetime.now().strftime('%H:%M:%S')}] 5 mail gần nhất đã được lọc xong, đang đợi email mới...")

    cur.close()
    conn.close()

if __name__ == '__main__':
    print("==================================================")
    print("=== HỆ THỐNG LỌC MAIL SPAM ===")
    print("==================================================")
    
    try:
        while True:
            run_filter()
            time.sleep(15)
    except KeyboardInterrupt:
        print("\nĐã dừng hệ thống.")