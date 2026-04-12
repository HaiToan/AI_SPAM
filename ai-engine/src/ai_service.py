from fastapi import FastAPI
import joblib
import os
import psycopg2
import uvicorn

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
BLACKLIST_KEYWORDS = ['win', 'million', 'dollars', 'prize', 'khuyến mãi', 'shopee', 'voucher',
                    'free', 'click', 'đăng ký', 'nhận ngay', 'giảm giá', 'không mất phí', 'đặc biệt', 
                    'cơ hội', 'hấp dẫn', 'không thể bỏ lỡ', 'đăng ký ngay', 'nhận quà', 'ưu đãi', 'giảm giá sốc',
                    'khuyến mãi lớn', 'mua 1 tặng 1', 'điện thoại miễn phí', 'không cần thẻ tín dụng',
                    'đăng ký miễn phí', 'cơ hội trúng thưởng', 'giảm giá cực sốc', 'không mất tiền', 'đặc biệt chỉ hôm nay', 'nhận ngay ưu đãi', 'giảm giá lên đến'
                    , 'phù hợp với bạn', 'on LinkedIn', 'đang phát trực tiếp','khởi đầu sự nghiệp với ngành sales', 'khởi đầu sự nghiệp vào ngành sales', 'hởi đầu sự nghiệp với ngành sales']

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
    is_blacklist = any(word in content_lower for word in BLACKLIST_KEYWORDS)
    
    if is_blacklist:
        prediction = "spam"
        print(f"🎯 Blacklist detected: {content[:30]}...")
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

if __name__ == "__main__":
    # Chạy ở Port 8000 (Vì 5000 là của Backend Dashboard rồi)
    uvicorn.run(app, host="127.0.0.1", port=8000)