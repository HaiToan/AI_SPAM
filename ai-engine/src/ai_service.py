from fastapi import FastAPI
import joblib
import os
import psycopg2
import uvicorn
from pydantic import BaseModel
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

# Quyền truy cập mở rộng (Thêm quyền lấy Avatar)
SCOPES = ['https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/userinfo.profile']

app = FastAPI()

# 1. Cấu hình đường dẫn Model
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, '..', 'models', 'spam_model.pkl')
VECTOR_PATH = os.path.join(BASE_DIR, '..', 'models', 'vectorizer.pkl')

# Nạp "bộ não" AI
model = joblib.load(MODEL_PATH)
tfidf = joblib.load(VECTOR_PATH)

# 2. Cấu hình Database theo thông tin Toàn cung cấp
DB_CONFIG = {
    "dbname": "gmail_spam_db",
    "user": "postgres",
    "password": "admin",
    "host": "localhost",
    "port": "5433"
}

# Danh sách từ khóa ép SPAM (Để chữa cháy khi AI đoán sai)
BLACKLIST_KEYWORDS = ['win', 'million', 'dollars', 'prize', 'khuyến mãi', 'shopee', 'voucher', 'cờ bạc', 'casino', 'đánh bài', 'lô đề'
                    'free', 'click', 'đăng ký', 'nhận ngay', 'giảm giá', 'không mất phí', 'đặc biệt', 
                    'cơ hội', 'hấp dẫn', 'không thể bỏ lỡ', 'đăng ký ngay', 'nhận quà', 'ưu đãi', 'giảm giá sốc',
                    'khuyến mãi lớn', 'mua 1 tặng 1', 'điện thoại miễn phí', 'không cần thẻ tín dụng',
                    'đăng ký miễn phí', 'cơ hội trúng thưởng', 'giảm giá cực sốc', 'không mất tiền', 'đặc biệt chỉ hôm nay', 'nhận ngay ưu đãi', 'giảm giá lên đến'
                    , 'phù hợp với bạn', 'on LinkedIn', 'đang phát trực tiếp','khởi đầu sự nghiệp với ngành sales', 'khởi đầu sự nghiệp vào ngành sales', 'hởi đầu sự nghiệp với ngành sales']

# Bộ nhớ phản xạ nhanh (Học thuộc lòng ngay lập tức)
DYNAMIC_SPAM_LIST = set()
DYNAMIC_HAM_LIST = set()

class KeywordRequest(BaseModel):
    action: str
    type: str
    word: str

class RollbackRequest(BaseModel):
    msg_id: str
    snippet: str = None

def save_to_db(snippet, prediction):
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO spam_logs (email_snippet, prediction, processed_at) VALUES (%s, %s, NOW())",
            (snippet[:255], prediction)
        )
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"❌ Lỗi lưu DB: {e}")

@app.get("/")
def home():
    return {"message": "AI Spam Detection Service is running!"}

@app.get("/predict")
def predict(content: str):
    # CHỮA CHÁY: Kiểm tra từ khóa trước khi dùng AI
    content_lower = content.lower()
    
    # 1. Kiểm tra Bộ nhớ phản xạ HAM (Whitelist)
    if any(snippet.lower() in content_lower for snippet in DYNAMIC_HAM_LIST if len(snippet) > 10):
        return {
            "content_preview": content[:50], 
            "prediction": "ham"
        }
        
    is_blacklist = any(word in content_lower for word in BLACKLIST_KEYWORDS)
    is_dynamic_spam = any(snippet.lower() in content_lower for snippet in DYNAMIC_SPAM_LIST if len(snippet) > 10)
    
    if is_blacklist or is_dynamic_spam:
        prediction = "spam"
        print(f"🎯 Blacklist / AI Learned SPAM detected: {content[:30]}...")
    else:
        # AI thực hiện dự đoán
        vectorized_text = tfidf.transform([content])
        
        # Lấy xác suất để tăng độ nhạy (Threshold)
        # Nếu model hỗ trợ predict_proba, ta sẽ hạ ngưỡng xuống để dễ ra SPAM hơn
        try:
            probs = model.predict_proba(vectorized_text)[0]
            # Giả sử index 1 là spam, nếu xác suất > 60% thì cho là spam
            prediction = 'spam' if probs[1] > 0.6 else 'ham'
        except:
            # Nếu model không hỗ trợ proba thì dùng predict mặc định
            prediction = model.predict(vectorized_text)[0]

    # Lưu vào Database
    
    return {
        "content_preview": content[:50], 
        "prediction": prediction
    }

@app.post("/rollback")
def rollback_email(req: RollbackRequest):
    creds = None
    
    # Tìm token.json ở các vị trí có thể xảy ra
    possible_paths = [
        os.path.join(BASE_DIR, 'token.json'),           # Thư mục src/
        os.path.join(BASE_DIR, '..', 'token.json'),     # Thư mục gốc ai-engine/
        'token.json'                                    # Thư mục đang đứng (CWD)
    ]
    
    token_path = None
    for path in possible_paths:
        if os.path.exists(path):
            token_path = path
            break

    if token_path:
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)

    # Tự động làm mới token nếu bị hết hạn
    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            with open(token_path, 'w') as token:
                token.write(creds.to_json())
        except Exception as e:
            print(f"Lỗi refresh token: {e}")
            pass

    if not creds or not creds.valid:
        return {"success": False, "error": "Không tìm thấy token.json hợp lệ. Thử chạy lại gmail_controller.py để tạo token."}

    # [MỚI] AI TỰ HỌC LẠI TỪ LỖI SAI (ACTIVE LEARNING)
    if req.snippet:
        try:
            import re
            import csv
            clean_snippet = re.sub(r'^\[.*?\]\s*', '', req.snippet)
            
            # Thêm vào bộ nhớ phản xạ nhanh
            DYNAMIC_HAM_LIST.add(clean_snippet.strip())

            X_new = tfidf.transform([clean_snippet])
            # Dạy lại AI rằng đây là HAM
            model.partial_fit(X_new, ['ham'], classes=['ham', 'spam'])
            joblib.dump(model, MODEL_PATH)
            
            # Lưu vĩnh viễn vào Dataset để cập nhật từ vựng khi train lại
            vie_data_path = os.path.join(BASE_DIR, '..', 'data', 'vie_dataset.csv')
            if os.path.exists(vie_data_path):
                with open(vie_data_path, mode='a', encoding='utf-8', newline='') as f:
                    writer = csv.writer(f)
                    writer.writerow(['ham', clean_snippet])
            
            print("🧠 AI vừa học thêm: Đã cập nhật thư này là HAM (Bộ nhớ nhanh + Dataset).")
        except Exception as e:
            print(f"Lỗi khi dạy lại AI: {e}")

    try:
        service = build('gmail', 'v1', credentials=creds)
        # Di chuyển email thực tế từ SPAM về INBOX trên Gmail
        service.users().messages().modify(
            userId='me', 
            id=req.msg_id,
            body={
                'removeLabelIds': ['SPAM'], 
                'addLabelIds': ['INBOX']      
            }
        ).execute()
        return {"success": True, "message": "Đã di chuyển về INBOX"}
    except Exception as e:
        return {"success": False, "error": f"Lỗi Gmail API: {str(e)}"}

@app.post("/mark-spam")
def mark_spam_email(req: RollbackRequest):
    creds = None
    
    possible_paths = [
        os.path.join(BASE_DIR, 'token.json'),           
        os.path.join(BASE_DIR, '..', 'token.json'),     
        'token.json'                                    
    ]
    
    token_path = None
    for path in possible_paths:
        if os.path.exists(path):
            token_path = path
            break

    if token_path:
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)

    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            with open(token_path, 'w') as token:
                token.write(creds.to_json())
        except Exception as e:
            print(f"Lỗi refresh token: {e}")
            pass

    if not creds or not creds.valid:
        return {"success": False, "error": "Không tìm thấy token.json hợp lệ. Thử chạy lại gmail_controller.py để tạo token."}

    # [MỚI] AI TỰ HỌC LẠI TỪ LỖI SAI (ACTIVE LEARNING)
    if req.snippet:
        try:
            import re
            import csv
            clean_snippet = re.sub(r'^\[.*?\]\s*', '', req.snippet)
            
            # Thêm vào bộ nhớ phản xạ nhanh
            DYNAMIC_SPAM_LIST.add(clean_snippet.strip())

            X_new = tfidf.transform([clean_snippet])
            # Dạy lại AI rằng đây là SPAM
            model.partial_fit(X_new, ['spam'], classes=['ham', 'spam'])
            joblib.dump(model, MODEL_PATH)
            
            # Lưu vĩnh viễn vào Dataset để cập nhật từ vựng khi train lại
            vie_data_path = os.path.join(BASE_DIR, '..', 'data', 'vie_dataset.csv')
            if os.path.exists(vie_data_path):
                with open(vie_data_path, mode='a', encoding='utf-8', newline='') as f:
                    writer = csv.writer(f)
                    writer.writerow(['spam', clean_snippet])

            print("🧠 AI vừa học thêm: Đã cập nhật thư này là SPAM (Bộ nhớ nhanh + Dataset).")
        except Exception as e:
            print(f"Lỗi khi dạy lại AI: {e}")

    try:
        service = build('gmail', 'v1', credentials=creds)
        # Di chuyển email thực tế từ INBOX vào SPAM trên Gmail
        service.users().messages().modify(
            userId='me', 
            id=req.msg_id,
            body={
                'removeLabelIds': ['INBOX'], 
                'addLabelIds': ['SPAM']      
            }
        ).execute()
        return {"success": True, "message": "Đã di chuyển vào SPAM"}
    except Exception as e:
        return {"success": False, "error": f"Lỗi Gmail API: {str(e)}"}

@app.get("/profile")
def get_profile():
    creds = None
    possible_paths = [
        os.path.join(BASE_DIR, 'token.json'),           
        os.path.join(BASE_DIR, '..', 'token.json'),     
        'token.json'                                    
    ]
    
    token_path = None
    for path in possible_paths:
        if os.path.exists(path):
            token_path = path
            break

    if token_path:
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)

    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            with open(token_path, 'w') as token:
                token.write(creds.to_json())
        except Exception:
            pass

    if not creds or not creds.valid:
        return {"success": False, "email": "Chưa kết nối Gmail"}

    try:
        service = build('gmail', 'v1', credentials=creds)
        profile = service.users().getProfile(userId='me').execute()
        email_address = profile.get('emailAddress')
        
        # Lấy Avatar từ Google Profile
        picture_url = ""
        user_name = ""
        try:
            oauth2_service = build('oauth2', 'v2', credentials=creds)
            user_info = oauth2_service.userinfo().get().execute()
            picture_url = user_info.get('picture', '')
            user_name = user_info.get('name', '')
        except Exception as e:
            pass
            
        return {"success": True, "email": email_address, "picture": picture_url, "name": user_name}
    except Exception as e:
        return {"success": False, "email": "Lỗi kết nối Gmail API", "picture": "", "name": ""}

@app.get("/keywords")
def get_keywords():
    return {
        "blacklist": BLACKLIST_KEYWORDS,
        "dynamic_spam": list(DYNAMIC_SPAM_LIST),
        "dynamic_ham": list(DYNAMIC_HAM_LIST)
    }

@app.post("/keywords")
def update_keywords(req: KeywordRequest):
    try:
        if req.action == 'add':
            if req.type == 'blacklist' and req.word not in BLACKLIST_KEYWORDS:
                BLACKLIST_KEYWORDS.append(req.word)
            elif req.type == 'dynamic_spam':
                DYNAMIC_SPAM_LIST.add(req.word)
            elif req.type == 'dynamic_ham':
                DYNAMIC_HAM_LIST.add(req.word)
        elif req.action == 'remove':
            if req.type == 'blacklist' and req.word in BLACKLIST_KEYWORDS:
                BLACKLIST_KEYWORDS.remove(req.word)
            elif req.type == 'dynamic_spam' and req.word in DYNAMIC_SPAM_LIST:
                DYNAMIC_SPAM_LIST.remove(req.word)
            elif req.type == 'dynamic_ham' and req.word in DYNAMIC_HAM_LIST:
                DYNAMIC_HAM_LIST.remove(req.word)
        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.post("/retrain")
def retrain_model():
    global model, tfidf
    try:
        import subprocess
        train_script = os.path.join(BASE_DIR, '..', 'models', 'train_model.py')
        # Chạy script train (Đợi cho đến khi xong)
        result = subprocess.run(["python", train_script], capture_output=True, text=True)
        
        # Nạp lại bộ não mới vào RAM
        model = joblib.load(MODEL_PATH)
        tfidf = joblib.load(VECTOR_PATH)
        
        return {"success": True, "output": result.stdout}
    except Exception as e:
        return {"success": False, "error": str(e)}

@app.get("/email/{msg_id}")
def get_full_email(msg_id: str):
    creds = None
    possible_paths = [os.path.join(BASE_DIR, 'token.json'), os.path.join(BASE_DIR, '..', 'token.json'), 'token.json']
    token_path = next((p for p in possible_paths if os.path.exists(p)), None)
    if token_path:
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)
        if creds and creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                with open(token_path, 'w') as token:
                    token.write(creds.to_json())
            except Exception: pass

    if not creds or not creds.valid:
        return {"success": False, "error": "Chưa kết nối Gmail"}

    try:
        service = build('gmail', 'v1', credentials=creds)
        message = service.users().messages().get(userId='me', id=msg_id, format='full').execute()
        
        def get_text(payload):
            if 'parts' in payload:
                for part in payload['parts']:
                    if part['mimeType'] == 'text/plain': return part.get('body', {}).get('data', '')
                    elif 'parts' in part:
                        res = get_text(part)
                        if res: return res
            return payload.get('body', {}).get('data', '')

        body_data = get_text(message.get('payload', {}))
        import base64
        if body_data:
            # Đảm bảo padding base64 chuẩn
            padded = body_data + '=' * (-len(body_data) % 4)
            full_text = base64.urlsafe_b64decode(padded).decode('utf-8', errors='ignore')
        else:
            full_text = message.get('snippet', '')
            
        # XAI: Phát hiện từ khóa Spam (Giải thích quyết định)
        text_lower = full_text.lower()
        spam_words = []
        for word in BLACKLIST_KEYWORDS:
            if word in text_lower: spam_words.append(word)
        for snippet in DYNAMIC_SPAM_LIST:
            if len(snippet) > 4 and snippet.lower() in text_lower: spam_words.append(snippet.lower())
                
        return {"success": True, "body": full_text, "spam_words": list(set(spam_words))}
    except Exception as e:
        return {"success": False, "error": str(e)}

if __name__ == "__main__":
    # Chạy ở Port 8000 (Vì 5000 là của Backend Dashboard rồi)
    uvicorn.run(app, host="127.0.0.1", port=8000)