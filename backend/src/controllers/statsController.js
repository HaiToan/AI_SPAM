const pool = require('../configs/db');

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
  try {
    const result = await pool.query('SELECT * FROM spam_logs ORDER BY processed_at DESC LIMIT 10');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};