import pandas as pd
import os
from sklearn.model_selection import train_test_split
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.naive_bayes import MultinomialNB
from sklearn.utils import resample
from sklearn.metrics import classification_report, confusion_matrix
import joblib

# 1. Thiết lập đường dẫn
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(BASE_DIR, '..', 'data', 'spam_ham_dataset.csv')

def train_model():
    # 2. Đọc dữ liệu
    if not os.path.exists(DATA_PATH):
        print(f"Lỗi: Không tìm thấy file tại {DATA_PATH}")
        return

    df = pd.read_csv(DATA_PATH, encoding='latin-1')
    
    # Giả sử file của ông có cột v1 (label) và v2 (text) như ông nói
    # Xử lý tên cột nếu cần (xóa các cột dư thừa nếu có)
    df = df[['v1', 'v2']]
    df.columns = ['label', 'text']

    print("--- Thống kê trước khi xử lý mất cân bằng ---")
    print(df['label'].value_counts())

    # 3. Xử lý mất cân bằng dữ liệu (Over-sampling nhóm Spam)
    df_ham = df[df['label'] == 'ham']
    df_spam = df[df['label'] == 'spam']

    # Nhân bản số lượng mẫu Spam cho bằng số lượng mẫu Ham
    df_spam_oversampled = resample(df_spam, 
                                   replace=True,    
                                   n_samples=len(df_ham), 
                                   random_state=42)

    # Gộp lại thành bộ dữ liệu mới cân bằng 50/50
    df_balanced = pd.concat([df_ham, df_spam_oversampled])

    print("\n--- Thống kê sau khi cân bằng dữ liệu ---")
    print(df_balanced['label'].value_counts())

    # 4. Tiền xử lý văn bản
    # Chuyển về chữ thường và xóa các ký tự đặc biệt cơ bản
    df_balanced['text'] = df_balanced['text'].str.lower()

    X = df_balanced['text']
    y = df_balanced['label']

    # 5. Chia tập dữ liệu Train/Test
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    # 6. Vector hóa văn bản với TF-IDF
    # Loại bỏ từ dừng tiếng Anh (stopwords)
    tfidf = TfidfVectorizer(stop_words='english', max_features=5000)
    X_train_tfidf = tfidf.fit_transform(X_train)
    X_test_tfidf = tfidf.transform(X_test)

    # 7. Huấn luyện mô hình Naive Bayes
    model = MultinomialNB()
    model.fit(X_train_tfidf, y_train)

    # 8. Đánh giá mô hình
    y_pred = model.predict(X_test_tfidf)
    print("\n--- Báo cáo chi tiết mô hình ---")
    print(classification_report(y_test, y_pred))

    # 9. Lưu model và vectorizer
    joblib.dump(model, os.path.join(BASE_DIR, 'spam_model.pkl'))
    joblib.dump(tfidf, os.path.join(BASE_DIR, 'vectorizer.pkl'))

    print("\n--- THÀNH CÔNG: Đã lưu spam_model.pkl và vectorizer.pkl ---")

if __name__ == "__main__":
    train_model()