import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Mail, ShieldCheck, AlertTriangle,
  CheckCircle, AlertCircle, PieChart as PieIcon, RefreshCcw,
  ChevronLeft, ChevronRight, Search, X, Info, User,
  Settings, Cpu, Trash2, Tag
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';

// --- STAT CARD COMPONENT (Giữ nguyên hoặc tinh chỉnh nhẹ) ---
const StatCard = ({ title, value, icon: Icon, color, delay }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay }}
    className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 flex items-center space-x-5"
  >
    <div className={`p-4 rounded-2xl ${color} shadow-lg text-white`}>
      <Icon size={28} />
    </div>
    <div>
      <p className="text-slate-500 text-sm font-medium">{title}</p>
      <h3 className="text-3xl font-black text-slate-800">{value}</h3>
    </div>
  </motion.div>
);

const highlightSpamWords = (text, words) => {
  if (!words || words.length === 0 || !text) return text;
  const escapedWords = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const regex = new RegExp(`(${escapedWords.join('|')})`, 'gi');
  const parts = text.split(regex);
  return parts.map((part, i) => 
      regex.test(part) ? <mark key={i} className="bg-rose-200 text-rose-800 font-bold px-1 rounded shadow-sm">{part}</mark> : part
  );
};

function App() {
  const [emails, setEmails] = useState([]);
  const [stats, setStats] = useState({ total: 0, spam: 0, ham: 0 });
  const [rollingBackIds, setRollingBackIds] = useState(new Set());
  const [markingSpamIds, setMarkingSpamIds] = useState(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [totalFilteredLogs, setTotalFilteredLogs] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [userEmail, setUserEmail] = useState('Đang tải...');
  const [userAvatar, setUserAvatar] = useState('');
  const [userName, setUserName] = useState('');
  const [fullEmail, setFullEmail] = useState(null);
  const [isLoadingEmail, setIsLoadingEmail] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [keywordsData, setKeywordsData] = useState({ blacklist: [], dynamic_spam: [], dynamic_ham: [] });
  const [newKeyword, setNewKeyword] = useState('');
  const itemsPerPage = 5;
  
  const prevTotalRef = useRef(0);

  const showToast = (message, type = 'success') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const fetchData = async () => {
    try {
      // Gọi cả 2 API cùng lúc
      const [resStats, resLogs, resProfile] = await Promise.all([
        fetch('http://localhost:5000/api/stats'),
        fetch(`http://localhost:5000/api/logs?page=${currentPage}&limit=${itemsPerPage}&search=${encodeURIComponent(searchQuery)}&status=${filterStatus}`),
        fetch('http://localhost:5000/api/profile')
      ]);
      
      const dataStats = await resStats.json();
      const dataLogs = await resLogs.json();
      const dataProfile = await resProfile.json().catch(() => ({ email: 'Chưa có thông tin' }));

      setStats(dataStats);
      
      // Hỗ trợ luồng dữ liệu mới phân trang với search
      if (dataLogs.data) {
        setEmails(dataLogs.data);
        setTotalFilteredLogs(dataLogs.total);
      } else {
        setEmails(dataLogs);
        setTotalFilteredLogs(dataStats.total);
      }

      if (dataProfile && dataProfile.email) {
        setUserEmail(dataProfile.email);
        setUserAvatar(dataProfile.picture || '');
        setUserName(dataProfile.name || '');
      }

      if (prevTotalRef.current > 0 && dataStats.total > prevTotalRef.current) {
        showToast(`Hệ thống vừa quét thêm ${dataStats.total - prevTotalRef.current} email mới!`, 'info');
      }
      prevTotalRef.current = dataStats.total;
    } catch (err) {
      console.error("Lỗi cập nhật dữ liệu:", err);
    }
  };

  useEffect(() => {
    fetchData(); // Chạy lần đầu
    
    // [MỚI] Sử dụng Server-Sent Events (SSE) để có Real-time thực sự (0.1s độ trễ)
    const eventSource = new EventSource('http://localhost:5000/api/stream');
    eventSource.onmessage = (event) => {
      if (event.data === 'update') {
        fetchData();
      }
    };
    return () => {
      eventSource.close();
    };
  }, [currentPage, searchQuery, filterStatus]);

  const handleOpenEmail = async (email) => {
    setSelectedEmail(email);
    setFullEmail(null);
    setIsLoadingEmail(true);
    const match = email.email_snippet.match(/^\[(.*?)\]/);
    if (match) {
      const msgId = match[1];
      try {
        const res = await fetch(`http://localhost:5000/api/email/${msgId}`);
        const data = await res.json();
        if (data.success) setFullEmail(data);
        else showToast("Lỗi lấy chi tiết thư: " + data.error, "error");
      } catch(e) {
        showToast("Lỗi kết nối tải thư chi tiết", "error");
      }
    }
    setIsLoadingEmail(false);
  };

  const handleRollback = async (email) => {
    // Lấy msg_id từ snippet (định dạng lưu trong DB: "[msg_id] Subject...")
    const match = email.email_snippet.match(/^\[(.*?)\]/);
    if (!match) {
      showToast("Không tìm thấy ID của email để khôi phục.", "error");
      return;
    }
    const msgId = match[1];

    try {
      setRollingBackIds(prev => new Set(prev).add(email.id));
      
      const res = await fetch('http://localhost:5000/api/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: email.id, msg_id: msgId, snippet: email.email_snippet })
      });

      if (res.ok) {
        showToast("Đã khôi phục email về Hộp thư đến!", "success");
        fetchData(); // Cập nhật lại UI ngay lập tức
        if (selectedEmail && selectedEmail.id === email.id) {
          setSelectedEmail(null); // Tự động đóng popup nếu thành công
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        showToast("Có lỗi: " + (errorData.error || "Không thể khôi phục email."), "error");
      }
    } catch (error) {
      console.error("Lỗi:", error);
    } finally {
      setRollingBackIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(email.id);
        return newSet;
      });
    }
  };

  const handleMarkAsSpam = async (email) => {
    const match = email.email_snippet.match(/^\[(.*?)\]/);
    if (!match) {
      showToast("Không tìm thấy ID của email để đánh dấu SPAM.", "error");
      return;
    }
    const msgId = match[1];

    try {
      setMarkingSpamIds(prev => new Set(prev).add(email.id));
      
      const res = await fetch('http://localhost:5000/api/mark-spam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: email.id, msg_id: msgId, snippet: email.email_snippet })
      });

      if (res.ok) {
        showToast("Đã đưa email vào Thư rác (Spam) thành công!", "success");
        fetchData();
        if (selectedEmail && selectedEmail.id === email.id) {
          setSelectedEmail(null); // Tự động đóng popup nếu thành công
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        showToast("Có lỗi: " + (errorData.error || "Không thể đưa vào thư rác."), "error");
      }
    } catch (error) {
      console.error("Lỗi:", error);
    } finally {
      setMarkingSpamIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(email.id);
        return newSet;
      });
    }
  };

  const chartData = [
    { name: 'Spam', value: stats.spam },
    { name: 'Safe', value: stats.ham },
  ];
  const COLORS = ['#F43F5E', '#10B981'];

  // Tính phần trăm để hiển thị
  const spamPercent = stats.total > 0 ? ((stats.spam / stats.total) * 100).toFixed(1) : 0;
  const totalPages = Math.max(1, Math.ceil(totalFilteredLogs / itemsPerPage));

  const loadKeywords = async () => {
    try {
      const res = await fetch('http://localhost:5000/api/keywords');
      setKeywordsData(await res.json());
    } catch(e) {}
  };

  const handleAddKeyword = async () => {
    if(!newKeyword.trim()) return;
    await fetch('http://localhost:5000/api/keywords', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({action: 'add', type: 'blacklist', word: newKeyword.trim()})
    });
    setNewKeyword('');
    loadKeywords();
  };

  const handleRemoveKeyword = async (word, type) => {
    await fetch('http://localhost:5000/api/keywords', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({action: 'remove', type, word})
    });
    loadKeywords();
  };

  const handleRetrain = async () => {
    showToast('Đang huấn luyện lại AI. Vui lòng đợi 15-30 giây...', 'info');
    try {
      const res = await fetch('http://localhost:5000/api/retrain', {method: 'POST'});
      const data = await res.json();
      if(data.success) showToast('Huấn luyện AI thành công! Mô hình đã được cập nhật.', 'success');
      else showToast('Lỗi huấn luyện: ' + data.error, 'error');
    } catch(e) { showToast('Lỗi kết nối Server', 'error'); }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] p-4 md:p-8 font-sans">
      {/* TOAST NOTIFICATION CONTAINER */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3">
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
              className={`flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-xl border text-sm font-bold min-w-[280px] max-w-sm ${
                toast.type === 'success' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                toast.type === 'error' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                'bg-blue-50 text-blue-700 border-blue-200'
              }`}
            >
              {toast.type === 'success' && <CheckCircle size={20} className="shrink-0" />}
              {toast.type === 'error' && <AlertCircle size={20} className="shrink-0" />}
              {toast.type === 'info' && <Info size={20} className="shrink-0" />}
              <span className="flex-1 leading-snug">{toast.message}</span>
              <button onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))} className="opacity-50 hover:opacity-100 transition-opacity">
                <X size={16} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* EMAIL DETAIL MODAL */}
      <AnimatePresence>
        {selectedEmail && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col"
            >
              <div className="flex items-center justify-between p-6 border-b border-slate-100">
                <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
                  <Mail className="text-blue-500" size={24} /> 
                  Chi tiết Email
                </h3>
                <button 
                  onClick={() => setSelectedEmail(null)}
                  className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="p-6 bg-slate-50 flex-1 overflow-y-auto max-h-[60vh]">
                {isLoadingEmail ? (
                  <div className="flex flex-col justify-center items-center h-40 text-slate-400 gap-3">
                    <RefreshCcw className="animate-spin" size={32} />
                    <p className="font-bold">Đang tải toàn bộ nội dung từ Gmail...</p>
                  </div>
                ) : fullEmail ? (
                    <div className="flex flex-col gap-2">
                      {fullEmail.spam_words && fullEmail.spam_words.length > 0 && (
                        <div className="bg-rose-100 border border-rose-200 text-rose-800 p-4 rounded-2xl text-sm font-bold flex gap-3 items-start mb-2 shadow-inner">
                          <AlertTriangle size={20} className="shrink-0 mt-0.5"/>
                          <div>
                            <p className="uppercase tracking-wider text-[10px] text-rose-500 mb-1">Explainable AI (XAI)</p>
                            <p>Hệ thống phát hiện các từ khóa nghi ngờ: <span className="font-black bg-white px-2 py-0.5 rounded-lg text-rose-600 ml-1">{fullEmail.spam_words.join(', ')}</span></p>
                          </div>
                        </div>
                      )}
                      <p className="text-slate-700 leading-relaxed whitespace-pre-wrap font-medium break-words text-[15px] bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
                        {fullEmail.spam_words ? highlightSpamWords(fullEmail.body, fullEmail.spam_words) : fullEmail.body}
                      </p>
                    </div>
                ) : (
                  <p className="text-slate-500 text-center mt-10 font-medium">Không thể tải nội dung gốc.</p>
                )}
              </div>
              <div className="p-5 border-t border-slate-100 bg-white flex justify-between items-center">
                <span className="text-xs font-bold text-slate-400">
                  Thời gian xử lý: {new Date(selectedEmail.processed_at).toLocaleString('vi-VN')}
                </span>
            <div className="flex gap-3">
              {selectedEmail.prediction === 'spam' ? (
                <button
                  onClick={() => handleRollback(selectedEmail)}
                  disabled={rollingBackIds.has(selectedEmail.id)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                  <RefreshCcw size={16} className={rollingBackIds.has(selectedEmail.id) ? "animate-spin" : ""} />
                  {rollingBackIds.has(selectedEmail.id) ? 'Đang xử lý...' : 'Khôi phục'}
                </button>
              ) : (
                <button
                  onClick={() => handleMarkAsSpam(selectedEmail)}
                  disabled={markingSpamIds.has(selectedEmail.id)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                  <AlertTriangle size={16} className={markingSpamIds.has(selectedEmail.id) ? "animate-spin" : ""} />
                  {markingSpamIds.has(selectedEmail.id) ? 'Đang xử lý...' : 'Báo Spam'}
                </button>
              )}
              <button onClick={() => setSelectedEmail(null)} className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-sm transition-colors">
                Đóng
              </button>
            </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* SETTINGS MODAL */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col"
            >
              <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50">
                <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
                  <Settings className="text-blue-500" size={24} /> 
                  Cài đặt Hệ thống AI
                </h3>
                <button onClick={() => setShowSettings(false)} className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-full transition-colors">
                  <X size={20} />
                </button>
              </div>
              <div className="p-8 flex-1 overflow-y-auto max-h-[70vh] flex flex-col gap-8">
                {/* Khu vực XAI - Blacklist */}
                <div className="space-y-4">
                  <h4 className="text-lg font-bold flex items-center gap-2 text-slate-800"><Tag size={20} className="text-rose-500"/> Quản lý Từ khóa SPAM (Blacklist)</h4>
                  <div className="flex gap-2">
                    <input type="text" value={newKeyword} onChange={e => setNewKeyword(e.target.value)} placeholder="Nhập từ khóa cần chặn..." className="flex-1 px-4 py-2 border border-slate-200 rounded-xl text-sm focus:border-blue-500 focus:outline-none"/>
                    <button onClick={handleAddKeyword} className="px-6 py-2 bg-slate-800 text-white font-bold rounded-xl text-sm hover:bg-slate-700 transition-colors">Thêm</button>
                  </div>
                  <div className="flex flex-wrap gap-2 mt-4 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                    {keywordsData.blacklist.map((word, idx) => (
                      <span key={idx} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-bold shadow-sm">
                        {word} <button onClick={() => handleRemoveKeyword(word, 'blacklist')} className="text-slate-400 hover:text-rose-500"><X size={14}/></button>
                      </span>
                    ))}
                    {keywordsData.blacklist.length === 0 && <span className="text-sm text-slate-400">Danh sách rỗng</span>}
                  </div>
                </div>
                
                {/* Khu vực Retrain */}
                <div className="space-y-4 pt-6 border-t border-slate-100">
                  <h4 className="text-lg font-bold flex items-center gap-2 text-slate-800"><Cpu size={20} className="text-emerald-500"/> Huấn luyện AI Đồng bộ</h4>
                  <p className="text-sm text-slate-500 font-medium">Hệ thống sẽ thu thập toàn bộ các mẫu thư bạn đã báo cáo để tính toán lại trọng số từ vựng (TF-IDF) và tái huấn luyện mô hình Naive Bayes.</p>
                  <button onClick={handleRetrain} className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-50 text-emerald-700 border border-emerald-200 font-bold rounded-xl text-sm hover:bg-emerald-100 transition-colors shadow-sm">
                    <RefreshCcw size={18} /> Tiến hành Huấn luyện lại (Retrain)
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="max-w-7xl mx-auto">
        
        {/* HEADER (Đã bỏ nút Refresh) */}
        <header className="mb-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <motion.h1 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-4xl font-black text-slate-900 tracking-tight"
            >
              AI Gmail <span className="text-red-600">SPAM</span>
            </motion.h1>
            <div className="flex items-center gap-2 mt-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
              </span>
              <p className="text-slate-500 text-sm font-medium">Đang tự động quét thư...</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="relative flex items-center gap-3 bg-white px-5 py-2.5 rounded-2xl shadow-sm border border-slate-100 cursor-pointer group"
            >
              {userAvatar ? (
              <img 
                src={userAvatar} 
                alt="Avatar" 
                className="w-10 h-10 rounded-full shadow-sm border border-slate-200 object-cover" 
                referrerPolicy="no-referrer" 
              />
            ) : (
              <div className="bg-blue-50 text-blue-600 p-2 rounded-full">
                <User size={20} />
              </div>
            )}
            <div className="flex flex-col">
              <span className="text-[10px] uppercase font-black text-slate-400 tracking-wider">Tài khoản đang quét</span>
              <span className="text-sm font-bold text-slate-700">{userEmail}</span>
            </div>

            {/* TOOLTIP HIỂN THỊ TÊN NGAY LẬP TỨC */}
            {userName && (
              <div className="absolute top-full mt-3 right-0 bg-slate-800 text-white text-sm font-bold px-4 py-2 rounded-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all whitespace-nowrap z-50 pointer-events-none shadow-xl">
                Tên tài khoản: {userName} 
                {/* Mũi tên nhỏ chỉ lên trên */}
                <div className="absolute -top-1.5 right-8 w-3 h-3 bg-slate-800 rotate-45 rounded-sm"></div>
              </div>
              )}
            </motion.div>
            
            <button onClick={() => { setShowSettings(true); loadKeywords(); }} className="p-3.5 bg-white rounded-2xl shadow-sm border border-slate-100 hover:bg-slate-50 transition-colors text-slate-500 hover:text-blue-600" title="Cài đặt Hệ thống">
              <Settings size={20} />
            </button>
          </div>
        </header>

        {/* STATS GRID */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <StatCard title="TỔNG EMAIL QUÉT" value={stats.total} icon={Mail} color="bg-blue-600" delay={0.1} />
          <StatCard title="PHÁT HIỆN SPAM" value={stats.spam} icon={AlertTriangle} color="bg-rose-500" delay={0.2} />
          <StatCard title="THƯ AN TOÀN" value={stats.ham} icon={ShieldCheck} color="bg-emerald-500" delay={0.3} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
          
          {/* PHẦN TỶ LỆ PHÂN LOẠI (THIẾT KẾ MỚI) */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white p-8 rounded-[2rem] shadow-sm border border-slate-100 relative overflow-hidden"
          >
            <div className="flex items-center justify-between mb-8">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <PieIcon className="text-blue-600" size={22} /> Tỷ lệ phân loại
              </h2>
            </div>

            <div className="relative h-64 w-full flex items-center justify-center">
              {/* Text ở giữa Donut Chart */}
              <div className="absolute text-center">
                <span className="text-4xl font-black text-slate-800">{spamPercent}%</span>
                <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">Spam Rate</p>
              </div>

              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    innerRadius={75}
                    outerRadius={95}
                    paddingAngle={10}
                    dataKey="value"
                    stroke="none"
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 20px rgba(0,0,0,0.05)' }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Chú thích chi tiết dưới biểu đồ */}
            <div className="mt-8 space-y-3">
              <div className="flex justify-between items-center p-3 bg-rose-50 rounded-2xl border border-rose-100">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-rose-500" />
                  <span className="text-sm font-bold text-rose-700">Thư rác (Spam)</span>
                </div>
                <span className="font-black text-rose-700">{stats.spam}</span>
              </div>
              <div className="flex justify-between items-center p-3 bg-emerald-50 rounded-2xl border border-emerald-100">
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-sm font-bold text-emerald-700">An toàn (Ham)</span>
                </div>
                <span className="font-black text-emerald-700">{stats.ham}</span>
              </div>
            </div>
          </motion.div>

          {/* TABLE SECTION (GIỮ NGUYÊN HOẶC CẬP NHẬT TRỐNG) */}
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="lg:col-span-2 bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden"
          >
            <div className="p-6 border-b border-slate-50 flex justify-between items-center bg-white/50 backdrop-blur-md sticky top-0">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold">Lịch sử xử lý</h2>
                <span className="px-3 py-1 bg-blue-50 text-blue-600 text-[10px] font-black rounded-full uppercase tracking-tighter shadow-sm border border-blue-100 hidden md:inline-block">LIVE FEED</span>
              </div>
              <div className="flex flex-col md:flex-row items-center gap-3 w-full md:w-auto mt-3 md:mt-0">
                <select
                  value={filterStatus}
                  onChange={(e) => {
                    setFilterStatus(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="w-full md:w-auto px-4 py-2 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 shadow-sm bg-slate-50 focus:bg-white transition-colors text-slate-600"
                >
                  <option value="all">Tất cả trạng thái</option>
                  <option value="spam">Chỉ Thư rác (Spam)</option>
                  <option value="ham">Chỉ An toàn (Ham)</option>
                </select>
                <div className="relative w-full md:w-auto">
                  <input 
                    type="text" 
                    placeholder="Tìm kiếm nội dung thư..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="pl-10 pr-4 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 w-full md:w-64 shadow-sm bg-slate-50 focus:bg-white transition-colors"
                  />
                  <div className="absolute left-3 top-2.5 text-slate-400">
                    <Search size={16} />
                  </div>
                </div>
              </div>
            </div>
            
            <div className="overflow-x-auto max-h-[550px]">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase font-bold tracking-widest sticky top-0">
                  <tr>
                    <th className="px-6 py-4">Nội dung tóm tắt</th>
                    <th className="px-6 py-4">Kết quả AI</th>
                    <th className="px-6 py-4">Thời gian</th>
                    <th className="px-6 py-4 text-center">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  <AnimatePresence>
                    {emails.map((email, index) => (
                      <motion.tr 
                        key={email.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                      onClick={() => handleOpenEmail(email)}
                      className={`transition-all group cursor-pointer ${selectedEmail && selectedEmail.id === email.id ? 'bg-blue-50/80 shadow-inner' : 'hover:bg-slate-50/50'}`}
                      >
                        <td className="px-6 py-5">
                          <p 
                          className="text-sm font-semibold text-slate-700 truncate max-w-xs group-hover:text-blue-600 transition-colors"
                            title="Nhấp để xem chi tiết"
                          >
                            {email.email_snippet.replace(/^\[.*?\]\s*/, '')}
                          </p>
                        </td>
                        <td className="px-6 py-5">
                          {email.prediction === 'spam' ? (
                            <div className="flex items-center gap-1.5 text-rose-600 bg-rose-50 px-3 py-1 rounded-full text-[11px] font-black border border-rose-100 w-fit">
                              <AlertCircle size={14} /> SPAM
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full text-[11px] font-black border border-emerald-100 w-fit">
                              <CheckCircle size={14} /> HAM
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-5">
                          <div className="flex flex-col">
                            <span className="text-xs text-slate-500 font-bold">
                              {new Date(email.processed_at).toLocaleTimeString('vi-VN')}
                            </span>
                            <span className="text-[10px] text-slate-400 font-medium mt-0.5">
                              {new Date(email.processed_at).toLocaleDateString('vi-VN')}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-5 text-center">
                          {email.prediction === 'spam' ? (
                            <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRollback(email);
                            }}
                              disabled={rollingBackIds.has(email.id)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-bold hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                              title="Khôi phục về Hộp thư đến"
                            >
                              <RefreshCcw size={14} className={rollingBackIds.has(email.id) ? "animate-spin" : ""} />
                              {rollingBackIds.has(email.id) ? 'Đang xử lý...' : 'Khôi phục'}
                            </button>
                          ) : (
                            <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleMarkAsSpam(email);
                            }}
                              disabled={markingSpamIds.has(email.id)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-bold hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                              title="Đánh dấu là Thư rác"
                            >
                              <AlertTriangle size={14} className={markingSpamIds.has(email.id) ? "animate-spin" : ""} />
                              {markingSpamIds.has(email.id) ? 'Đang xử lý...' : 'Báo Spam'}
                            </button>
                          )}
                        </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>

            {/* CONTROLS PHÂN TRANG */}
            <div className="p-4 border-t border-slate-50 flex items-center justify-center gap-6 bg-white/50 backdrop-blur-md">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-2 rounded-xl bg-slate-50 text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors border border-slate-200 shadow-sm"
              >
                <ChevronLeft size={18} />
              </button>

              <span className="text-sm font-semibold text-slate-500 min-w-[100px] text-center">
                Trang {currentPage} / {totalPages}
              </span>

              <button
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage >= totalPages}
                className="p-2 rounded-xl bg-slate-50 text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-100 transition-colors border border-slate-200 shadow-sm"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}

export default App;