const pool = require('../configs/db');

// --- THÊM: Hỗ trợ Real-time (Server-Sent Events) ---
let clients = [];

exports.sse = (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  clients.push(res);
  req.on('close', () => {
    clients = clients.filter(client => client !== res);
  });
};

exports.notify = (req, res) => {
  clients.forEach(client => client.write(`data: update\n\n`));
  res.json({ success: true });
};

// Lấy số liệu thống kê
exports.getStats = async (req, res) => {
  try {
    const total = await pool.query('SELECT COUNT(*) FROM spam_logs');
    const spam = await pool.query("SELECT COUNT(*) FROM spam_logs WHERE prediction = 'spam'");
    const ham = await pool.query("SELECT COUNT(*) FROM spam_logs WHERE prediction = 'ham'");
    
    res.json({
      total: parseInt(total.rows[0].count),
      spam: parseInt(spam.rows[0].count),
      ham: parseInt(ham.rows[0].count)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Lấy 10 mail gần nhất
exports.getRecentLogs = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 5;
  const search = req.query.search || '';
  const status = req.query.status || 'all';
  const offset = (page - 1) * limit;

  try {
    const conditions = [];
    const values = [];
    
    if (search) {
      values.push(`%${search}%`);
      conditions.push(`email_snippet ILIKE $${values.length}`);
    }
    
    if (status === 'spam' || status === 'ham') {
      values.push(status);
      conditions.push(`prediction = $${values.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    const countResult = await pool.query(`SELECT COUNT(*) FROM spam_logs ${whereClause}`, values);
    
    const queryValues = [...values, limit, offset];
    const result = await pool.query(`SELECT * FROM spam_logs ${whereClause} ORDER BY processed_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, queryValues);
    
    res.json({ data: result.rows, total: parseInt(countResult.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Khôi phục email từ Spam về Inbox
exports.rollbackEmail = async (req, res) => {
  const { id, msg_id, snippet } = req.body;
  try {
    // Kiểm tra xem Node.js có hỗ trợ fetch không
    if (typeof fetch === 'undefined') {
      return res.status(500).json({ error: "Node.js của bạn quá cũ, không hỗ trợ lệnh fetch. Hãy nâng cấp Node.js hoặc báo lại để đổi sang thư viện axios." });
    }

    // 1. Gọi AI Service (Python FastAPI) TRƯỚC để di chuyển mail thực tế
    const aiResponse = await fetch('http://localhost:8000/rollback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_id, snippet })
    });
    
    // Tránh sập nếu Python không trả về JSON (vd: sập server Python)
    const responseText = await aiResponse.text();
    let aiData;
    try {
      aiData = JSON.parse(responseText);
    } catch (parseError) {
      console.error("AI Service trả về lỗi không phải JSON:", responseText);
      return res.status(500).json({ error: "Server AI bị lỗi: " + responseText.substring(0, 100) });
    }

    // Dùng !== true để bắt cả trường hợp Python trả về lỗi không có biến success (vd: 422 Error)
    if (aiData.success !== true) {
      // Báo lỗi ngay lập tức, KHÔNG cập nhật DB
      if (aiData.detail === "Not Found") {
        return res.status(500).json({ error: "Chưa khởi động lại Server AI. Vui lòng tắt terminal chạy Python và chạy lại file ai_service.py!" });
      }
      
      const errorMsg = aiData.error || (aiData.detail ? JSON.stringify(aiData.detail) : `Phản hồi lỗi từ AI: ${responseText}`);
      return res.status(500).json({ error: errorMsg });
    }

    // 2. Chỉ khi Gmail di chuyển thành công, mới đổi trạng thái trong DB
    await pool.query("UPDATE spam_logs SET prediction = 'ham' WHERE id = $1", [id]);

    res.json({ success: true, message: "Đã khôi phục email thành công" });
  } catch (err) {
    console.error("Lỗi hệ thống:", err.message);
    res.status(500).json({ error: "Lỗi kết nối hoặc thực thi: " + err.message });
  }
};

// Đánh dấu email là Spam (Đưa vào thư rác)
exports.markAsSpam = async (req, res) => {
  const { id, msg_id, snippet } = req.body;
  try {
    if (typeof fetch === 'undefined') {
      return res.status(500).json({ error: "Node.js của bạn quá cũ, không hỗ trợ lệnh fetch. Hãy nâng cấp Node.js hoặc báo lại để đổi sang thư viện axios." });
    }

    // 1. Gọi AI Service để gắn nhãn SPAM trên Gmail thực tế
    const aiResponse = await fetch('http://localhost:8000/mark-spam', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_id, snippet })
    });
    
    const responseText = await aiResponse.text();
    let aiData;
    try {
      aiData = JSON.parse(responseText);
    } catch (parseError) {
      return res.status(500).json({ error: "Server AI bị lỗi: " + responseText.substring(0, 100) });
    }

    if (aiData.success !== true) {
      if (aiData.detail === "Not Found") {
        return res.status(500).json({ error: "Chưa khởi động lại Server AI. Vui lòng tắt terminal chạy Python và chạy lại file ai_service.py!" });
      }
      const errorMsg = aiData.error || (aiData.detail ? JSON.stringify(aiData.detail) : `Phản hồi lỗi từ AI: ${responseText}`);
      return res.status(500).json({ error: errorMsg });
    }

    // 2. Cập nhật lại Database thành 'spam'
    await pool.query("UPDATE spam_logs SET prediction = 'spam' WHERE id = $1", [id]);
    res.json({ success: true, message: "Đã đưa vào thư rác thành công" });
  } catch (err) {
    res.status(500).json({ error: "Lỗi kết nối hoặc thực thi: " + err.message });
  }
};

// Lấy thông tin Profile (Email đang quét)
exports.getProfile = async (req, res) => {
  try {
    if (typeof fetch === 'undefined') {
      return res.json({ email: "Node.js không hỗ trợ fetch", picture: "", name: "" });
    }
    const aiResponse = await fetch('http://localhost:8000/profile');
    const aiData = await aiResponse.json();
    if (aiData.success) {
      res.json({ email: aiData.email, picture: aiData.picture, name: aiData.name });
    } else {
      res.json({ email: aiData.email || "Chưa đồng bộ Gmail", picture: "", name: "" });
    }
  } catch (err) {
    res.json({ email: "Đang mất kết nối AI...", picture: "", name: "" });
  }
};

// Gọi API quản lý từ khóa
exports.getKeywords = async (req, res) => {
  try {
    const response = await fetch('http://localhost:8000/keywords');
    res.json(await response.json());
  } catch (err) { res.status(500).json({ error: err.message }); }
};

exports.updateKeyword = async (req, res) => {
  try {
    const response = await fetch('http://localhost:8000/keywords', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.body)
    });
    res.json(await response.json());
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// Gọi API huấn luyện lại
exports.retrainModel = async (req, res) => {
  try {
    const response = await fetch('http://localhost:8000/retrain', { method: 'POST' });
    res.json(await response.json());
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// Gọi API lấy toàn bộ nội dung thư (Kèm giải thích XAI)
exports.getFullEmail = async (req, res) => {
  try {
    const msgId = req.params.msg_id;
    const response = await fetch(`http://localhost:8000/email/${msgId}`);
    res.json(await response.json());
  } catch (err) { res.status(500).json({ error: err.message }); }
};